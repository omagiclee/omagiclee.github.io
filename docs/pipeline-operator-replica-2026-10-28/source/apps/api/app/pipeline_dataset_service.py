"""Verified documents -> independently editable candidates; no plugin quality trust."""
import hashlib
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, StrictStr, ValidationError, field_validator
from fastapi import HTTPException
from sqlalchemy import select, update
from .artifact_store import canonical, iter_records, verify_stream
from .data_platform_models import DataDataset, DataSample
from . import data_platform_service as data
from .pipeline_models import PipelineArtifact, PipelineRun, PipelineRunSubmission
from .pipeline_dataset_models import PipelineDatasetImport, PipelineDatasetSample

MAPPING_VERSION = 'documents-to-sft-candidate.v1'
MAX_IMPORT_RECORDS = 1000
MAPPING = {'version': MAPPING_VERSION, 'id': 'source_id', 'text': 'input',
           'optional_metadata': ['name', 'output', 'label', 'source_group', 'split'],
           'default_split': 'unassigned', 'quality_profile': 'sft-v1', 'state': '待标注'}
MAPPING_DIGEST = data.digest(MAPPING)


class DocumentMetadata(BaseModel):
    model_config = ConfigDict(extra='ignore', strict=True)
    name: StrictStr | None = Field(default=None, min_length=1, max_length=160)
    output: StrictStr = Field(default='', max_length=200000)
    label: StrictStr = Field(default='', max_length=4000)
    source_group: StrictStr | None = Field(default=None, min_length=1, max_length=160)
    split: Literal['train', 'validation', 'test', 'unassigned'] = 'unassigned'

    @field_validator('name', 'source_group')
    @classmethod
    def visible(cls, value):
        if value is not None and not value.strip():
            raise ValueError('Source identity and input must contain visible text')
        return value


class Document(BaseModel):
    # Other operator fields are retained in immutable record hashes but do not
    # become permissions, assets, annotation state or quality decisions.
    model_config = ConfigDict(extra='ignore', strict=True)
    id: StrictStr = Field(min_length=1, max_length=160)
    text: StrictStr = Field(min_length=1, max_length=200000)
    metadata: DocumentMetadata = Field(default_factory=DocumentMetadata)

    @field_validator('id', 'text')
    @classmethod
    def visible(cls, value):
        if not value.strip():
            raise ValueError('Source identity and input must contain visible text')
        return value


def source(imported):
    return {'run_id': imported.run_id, 'artifact_id': imported.artifact_id,
            'content_hash': imported.content_hash, 'mapping_version': imported.mapping_version,
            'mapping_digest': imported.mapping_digest}


def dataset_source(db, dataset_id):
    imported = db.scalar(select(PipelineDatasetImport).where(PipelineDatasetImport.dataset_id == dataset_id))
    return source(imported) if imported else None


def source_artifact(db, artifact_id, project_id):
    artifact = db.get(PipelineArtifact, artifact_id)
    if artifact is None or artifact.project_id != project_id:
        raise HTTPException(404, '流水线产物不存在')
    run = db.get(PipelineRun, artifact.run_id)
    if run is None or run.project_id != project_id:
        raise HTTPException(404, '流水线运行不存在')
    submission = db.scalar(select(PipelineRunSubmission).where(PipelineRunSubmission.run_id == run.id))
    options = submission.request_options if submission and isinstance(submission.request_options, dict) else {}
    if options.get('mode', 'production') != 'production':
        raise HTTPException(422, '调试产物不能导入候选数据集，请正式运行流水线')
    if run.status != 'succeeded':
        raise HTTPException(422, '仅成功的正式运行可导入候选数据集')
    if artifact.type != 'documents' or artifact.payload.get('type') != 'documents':
        raise HTTPException(422, '当前仅支持documents产物')
    if artifact.record_count > MAX_IMPORT_RECORDS:
        raise HTTPException(422, '当前同步导入最多1000条；更大批量需要后续异步导入')
    if artifact.record_count < 1:
        raise HTTPException(422, '产物至少须包含1条记录')
    manifest = artifact.payload.get('manifest')
    if isinstance(manifest, dict) and manifest.get('record_count') != artifact.record_count:
        raise HTTPException(422, '产物记录数与声明不符，未创建数据集')
    if isinstance(manifest, dict):
        shards = manifest.get('shards')
        if (not isinstance(shards, list) or not 0 < len(shards) <= artifact.record_count
                or any(not isinstance(shard, dict) or type(shard.get('record_count')) is not int
                       or shard['record_count'] < 1 for shard in shards)
                or sum(shard['record_count'] for shard in shards) != artifact.record_count):
            raise HTTPException(422, '产物分片记录数与声明不符，未创建数据集')
    if 'manifest' not in artifact.payload and (
            not isinstance(artifact.payload.get('records'), list)
            or len(artifact.payload['records']) != artifact.record_count):
        raise HTTPException(422, '产物记录数与声明不符，未创建数据集')
    try:
        verify_stream(artifact.payload, project_id, artifact.content_hash)
    except (ValueError, OSError, KeyError, TypeError) as error:
        raise HTTPException(422, '产物完整性校验失败，未创建数据集') from error
    return artifact


def identity(artifact, name, idempotency_key):
    request_hash = data.digest({'project_id': artifact.project_id, 'artifact_id': artifact.id,
                              'content_hash': artifact.content_hash, 'mapping_digest': MAPPING_DIGEST, 'name': name})
    return ('key:' + str(idempotency_key) if idempotency_key else 'derived:' + request_hash), request_hash


def existing(db, project_id, request_identity, request_hash):
    imported = db.scalar(select(PipelineDatasetImport).where(
        PipelineDatasetImport.project_id == project_id, PipelineDatasetImport.request_identity == request_identity))
    if imported and imported.request_hash != request_hash:
        raise HTTPException(409, '此导入请求标识已用于不同产物或名称')
    return imported


def result(db, imported, created):
    dataset = data.owned(db, DataDataset, imported.dataset_id, imported.project_id)
    return {'dataset_id': dataset.id, 'created': created, 'source': source(imported),
            'quality_report': data.quality(db, dataset)}


def create_candidate(db, artifact, name, request_identity, request_hash, user_id):
    dataset = DataDataset(project_id=artifact.project_id, name=name, modality='文本', purpose='训练',
                          source=f'pipeline:{artifact.run_id}/artifact:{artifact.id}', quality_profile='sft-v1')
    db.add(dataset)
    db.flush()
    imported = PipelineDatasetImport(project_id=artifact.project_id, dataset_id=dataset.id,
        artifact_id=artifact.id, run_id=artifact.run_id, content_hash=artifact.content_hash,
        mapping_version=MAPPING_VERSION, mapping_digest=MAPPING_DIGEST, request_identity=request_identity,
        request_hash=request_hash, imported_by=user_id)
    db.add(imported)
    db.flush()  # Reserve request identity in the same transaction as the candidate.
    count, batch = 0, []
    for record in iter_records(artifact.payload, artifact.project_id):
        count += 1
        try:
            document = Document.model_validate(record)
        except ValidationError as error:
            raise HTTPException(422, f'第{count}条documents记录不符合导入映射') from error
        metadata = document.metadata
        sample = DataSample(project_id=artifact.project_id, dataset_id=dataset.id, name=metadata.name or document.id,
                            input=document.text, output=metadata.output, label=metadata.label,
                            source_id=document.id, source_group=metadata.source_group, split=metadata.split,
                            content_hash=data.input_hash(document.text), state='待标注')
        db.add(sample)
        batch.append((sample, hashlib.sha256(canonical(record)).hexdigest()))
        if len(batch) == 100:
            _flush_samples(db, imported, batch)
            batch = []
    _flush_samples(db, imported, batch)
    if count != artifact.record_count:
        raise HTTPException(422, '产物记录数与声明不符，未创建数据集')
    return imported


def _flush_samples(db, imported, batch):
    db.flush()
    # Source identity is unique within this import, checked by immutable evidence
    # plus a database constraint (also covers identities from earlier batches).
    for sample, record_hash in batch:
        db.add(PipelineDatasetSample(sample_id=sample.id, import_id=imported.id,
                                    source_id=sample.source_id, record_hash=record_hash, input_hash=sample.content_hash))
    db.flush()
    for sample, _ in batch:
        db.expunge(sample)


def fence_publication(db, dataset):
    """Fence the dataset commit boundary without acquiring sample write locks."""
    if dataset_source(db, dataset.id) is None:
        return
    # All public mutations of published sample fields also compare-and-swap the
    # dataset revision in the same transaction (import, annotation, review,
    # split and annotation batches). Holding this row prevents those writes
    # from committing between the quality check and the immutable snapshot.
    # Read sample rows normally: PostgreSQL MVCC exposes their committed values
    # even if an annotator holds a sample lock while waiting for this dataset.
    # Taking sample locks here would reverse the annotator's sample->dataset
    # order and introduce a deadlock.
    db.execute(update(DataDataset).where(DataDataset.id == dataset.id).values(revision=DataDataset.revision))
