FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY *.go ./
RUN go mod tidy && CGO_ENABLED=0 go build -o /out/worker .

FROM alpine:3.19
RUN adduser -D app && mkdir -p /app/uploads && chown app /app/uploads
COPY --from=build /out/worker /usr/local/bin/worker
USER app
WORKDIR /app
CMD ["worker"]
