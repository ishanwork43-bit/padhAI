class APIError(Exception):
    """Only deliberate public messages may cross the HTTP error boundary."""

    def __init__(
        self, status: int, code: str, message: str, retry_after: int | None = None
    ):
        self.status = status
        self.code = code
        self.message = message
        self.retry_after = retry_after
        super().__init__(message)

    def payload(self):
        return {
            "error": {
                "code": self.code,
                "message": self.message,
                "retry_after": self.retry_after,
            }
        }
