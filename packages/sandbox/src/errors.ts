export class SandboxError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'docker_missing'
      | 'runsc_missing'
      | 'invalid_extract_dir'
      | 'docker_failed'
      | 'timeout',
  ) {
    super(message);
    this.name = 'SandboxError';
  }
}
