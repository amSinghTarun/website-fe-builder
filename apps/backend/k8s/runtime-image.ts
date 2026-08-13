export function runtimeImage(repository: string): string {
  const tag = process.env.RUNTIME_IMAGE_TAG?.trim() || "latest";
  return `${repository}:${tag}`;
}
