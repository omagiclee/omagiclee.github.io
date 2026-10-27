import { platformRequest, platformUrl, type PageResult } from "./data-platform-api";

export interface TrainingTemplate {id:string;name:string;description:string;backend:string;defaults?:{parameters?:Record<string,number>;resources?:Record<string,unknown>};limitations?:string[]}
export interface TrainingJob {id:string;name:string;status:string;runtimeStatus:string;revision:number;backend:string;templateId:string;datasetVersionId:string;datasetId:string;datasetDigest:string;trainSampleCount:number;valSampleCount:number;modelId?:string;modelName:string;modelVersion:string;artifactDigest?:string;parameters:Record<string,number>;resources:Record<string,unknown>;progress:Record<string,number>;checkpointUri?:string;checkpointSha256?:string;error?:string;codeRevision:string;image:string;createdAt:string;updatedAt:string;externalRef?:string}
export interface TrainingMetric {id:string;attempt:number;epoch:number;step:number;metrics:Record<string,number>;logs:string;createdAt:string}
export interface TrainingCheckpoint {id:string;attempt:number;epoch:number;step:number;uri:string;digest:string;createdAt:string}
export type TrainingPageResult<T> = PageResult<T> & {summary?:{total:number;statusCounts:Record<string,number>}};
export const trainingGet = <T>(project:string,path:string) => platformRequest<T>(project,`/training${path}`);
export const trainingWrite = <T>(project:string,path:string,csrf:string,body:unknown) => platformRequest<T>(project,`/training${path}`,csrf,body);
export const trainingArtifactUrl = (project:string,job:string) => platformUrl(project,`/training/jobs/${encodeURIComponent(job)}/artifact`);
export const trainingStatus:Record<string,string>={draft:"草稿",queued:"排队中",running:"训练中",pausing:"暂停中",paused:"已暂停",cancelling:"取消中",cancelled:"已取消",failed:"失败",completed:"已完成",pending:"待提交"};
