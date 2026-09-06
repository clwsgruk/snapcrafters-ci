export class InputError extends Error {
  override readonly name = "InputError";
}

export class AuthorizationError extends Error {
  override readonly name = "AuthorizationError";
}

export class ConflictError extends Error {
  override readonly name = "ConflictError";
}

export class PartialPublicationError extends Error {
  override readonly name = "PartialPublicationError";

  constructor(
    message: string,
    readonly completedStages: readonly string[],
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
