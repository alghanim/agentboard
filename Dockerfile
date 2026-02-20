FROM golang:1.23-alpine AS builder
WORKDIR /build
COPY backend/ .
RUN go build -o agentboard .

FROM alpine:3.19
RUN apk add --no-cache ca-certificates tzdata
COPY --from=builder /build/agentboard /app/agentboard
COPY --from=builder /build/schema.sql /app/schema.sql
ENTRYPOINT ["/app/agentboard"]
