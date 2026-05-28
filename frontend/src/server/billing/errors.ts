export class InvalidSubscriptionInputError extends Error {
  constructor(message = "Invalid subscription input") {
    super(message);
    this.name = "InvalidSubscriptionInputError";
  }
}
