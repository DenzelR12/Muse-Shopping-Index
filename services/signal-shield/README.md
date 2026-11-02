# services/signal-shield — library stub, not a deployed service

Status: design-stage library code. A single pure function (`evaluateRisk`)
adds simple velocity/amount/device signals to an actor's risk score and
defers the allow/deny decision to `@gift-signal/policy`. It has no server,
no deployment, and no tests, and it is not a running risk service.
