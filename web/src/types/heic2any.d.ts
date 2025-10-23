declare module 'heic2any' {
  interface Heic2AnyOptions {
    blob: Blob;
    toType?: string;
    quality?: number;
  }

  type Heic2AnyResult = Blob | Blob[];

  function heic2any(options: Heic2AnyOptions): Promise<Heic2AnyResult>;

  export default heic2any;
}
