import mod from './generateSwagger.cjs';

export const DEFAULT_OPTIONS = mod.DEFAULT_OPTIONS;
export const mergeOptions = mod.mergeOptions;
export const parseServerSentEvent = mod.parseServerSentEvent;
export const parseJsonResponseText = mod.parseJsonResponseText;
export const requestJsonOnce = mod.requestJsonOnce;
export const generateSwaggerFromHttp = mod.generateSwaggerFromHttp;
export const generateSwaggerFromFile = mod.generateSwaggerFromFile;
export const generateTypes = mod.generateTypes;
export const generateUnionArrays = mod.generateUnionArrays;
export const handleSwaggerData = mod.handleSwaggerData;
export const connectToSwaggerEventStream = mod.connectToSwaggerEventStream;
export const generateSwaggerServices = mod.generateSwaggerServices;
export default mod;
