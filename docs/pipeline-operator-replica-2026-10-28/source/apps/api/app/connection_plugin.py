"""Bounded UTF-8 document source backed by a committed connection inventory."""
from pathlib import Path
import tempfile
from pydantic import Field
from sqlalchemy import select
from .pipeline_sdk import OperatorConfig,OperatorDefinition,PluginDefinition

class ObjectDocumentsConfig(OperatorConfig):
    connection_id:str=Field(min_length=1,max_length=36)
    inventory_generation:int=Field(ge=1)


def dataset_handler(config,payload):
    raise ValueError('Object document sources require the batch-v1 execution context')


def batches(config,payload,context):
    from . import database
    from .connection_runtime import ObjectConnector
    from .platform_models import ProjectConnection
    from .runtime_governance_models import ConnectionInventoryCursor,ConnectionInventoryObject
    if not context.project_id or not context.environment_id:
        raise ValueError('Object sources require a selected project execution environment')
    offset=context.partition_index*64
    while True:
        with database.SessionLocal() as db:
            connection=db.get(ProjectConnection,config.connection_id)
            state=db.get(ConnectionInventoryCursor,config.connection_id)
            if not connection or not state or state.generation!=config.inventory_generation or state.cursor is not None or state.lease_token:
                raise ValueError('Object source requires the same completed inventory generation throughout execution')
            driver=ObjectConnector(connection,context.project_id,context.environment_id,db)
            rows=list(db.scalars(select(ConnectionInventoryObject).where(ConnectionInventoryObject.connection_id==config.connection_id,
                ConnectionInventoryObject.project_id==context.project_id,ConnectionInventoryObject.generation==config.inventory_generation)
                .order_by(ConnectionInventoryObject.object_key).offset(offset).limit(64)))
            if not rows:return
            records=[]
            with tempfile.TemporaryDirectory(prefix='flywheel-object-docs-') as root:
                for index,row in enumerate(rows):
                    if row.size>50_000:raise ValueError('Object document exceeds 50,000 bytes; use a media or custom batch adapter')
                    target=Path(root)/str(index)
                    driver.download_file(row.uri,target,maximum=50_000,expected_etag=row.etag)
                    records.append({'id':row.id,'text':target.read_text(encoding='utf-8'),
                        'metadata':{'uri':row.uri,'etag':row.etag,'size':row.size,'connection_id':config.connection_id}})
            yield {'type':'documents','records':records,'metadata':{'inventory_generation':config.inventory_generation}}
            offset+=len(rows)


def plugin():
    return PluginDefinition(id='object.storage',name='对象存储接入',description='读取已提交目录的 UTF-8 文档，按项目执行环境解析服务器凭据。',operators=(
        OperatorDefinition(id='object_documents_source',name='对象存储文档源',description='按已完成目录轮次有界读取 UTF-8 文档；源变更会拒绝读取。',
            kind='source',input_type=None,output_type='documents',config_model=ObjectDocumentsConfig,handler=dataset_handler,
            default_config={'connection_id':'choose-connection','inventory_generation':1},deterministic=False,retry_safe=True,cacheable=False,batch_handler=batches,batch_size=64),))
