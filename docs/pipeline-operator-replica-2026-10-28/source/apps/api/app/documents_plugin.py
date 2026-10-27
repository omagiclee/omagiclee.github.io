"""Small, audited document operators for reproducible pipeline development.

The inline source reads only the immutable version configuration. Neither
operator accesses the network, project filesystem, credentials or models.
"""

from pydantic import Field, field_validator

from .pipeline_sdk import DocumentRecord, OperatorConfig, OperatorDefinition, PluginDefinition


class InlineDocumentsConfig(OperatorConfig):
    records: list[DocumentRecord] = Field(min_length=1, max_length=5000)

    @field_validator("records")
    @classmethod
    def unique_ids(cls, records):
        if len({record.id for record in records}) != len(records):
            raise ValueError("文档输入中的记录 ID 必须唯一")
        return records


class FilterDocumentsConfig(OperatorConfig):
    min_length: int = Field(default=0, ge=0, le=50_000)
    contains: str = Field(default="", max_length=1000)


def inline_documents(config, payload):
    return {"type": "documents", "records": [record.model_dump() for record in config.records], "metadata": {}}


def filter_documents(config, payload):
    return {**payload, "records": [record for record in payload["records"]
        if len(record["text"]) >= config.min_length and config.contains in record["text"]]}


def plugin():
    return PluginDefinition(id="documents.core", name="内置文档处理", description="固定内联文档输入与纯文本过滤，支持小样本调试。", operators=(
        OperatorDefinition(id="documents.inline", name="固定文档输入", description="使用保存版本中的固定文档记录，按记录顺序采样。",
            kind="source", input_type=None, output_type="documents", config_model=InlineDocumentsConfig,
            handler=inline_documents, default_config={"records": [
                {"id": "sample-1", "text": "用于流水线调试的第一条固定文档", "metadata": {}},
                {"id": "sample-2", "text": "第二条固定文档", "metadata": {}}]}, retry_safe=True, cacheable=True),
        OperatorDefinition(id="documents.filter", name="文档过滤", description="按文本长度与包含内容过滤，保留记录身份及元数据。",
            kind="transform", input_type="documents", output_type="documents", config_model=FilterDocumentsConfig,
            handler=filter_documents, default_config={"min_length": 0, "contains": ""}, retry_safe=True, cacheable=True),
    ))
