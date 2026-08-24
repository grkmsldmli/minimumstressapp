/**
 * Which storage paths the admin document route is willing to sign.
 *
 * A signed URL is "fetch me this exact object", so the path a staff request
 * names has to be one this app actually files a verification document under —
 * `space/{hostId}/{spaceId}/{file}` for a listing, `practitioner/{userId}/{file}`
 * for a certificate — and nothing else. The parameter is untrusted: `..`
 * segments and absolute-looking paths are the class of thing storage layers
 * disagree about, and a bare filename is exactly what the old, broken upload
 * left in `insurance_doc_path`. Anchored and segment-shaped so none of those
 * reach `createSignedUrl`.
 *
 * Pure and shared, so the route enforces this and the tests can prove it. The
 * shapes match the paths produced by spaceDocPath / practitionerDocPath in
 * uploads.ts and the storage policies in 0003/0017.
 */
export function isVerificationDocPath(path: string): boolean {
  return (
    /^space\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[\w.-]+$/i.test(path) ||
    /^practitioner\/[0-9a-f-]{36}\/[\w.-]+$/i.test(path)
  );
}
