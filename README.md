# Synadia Whiteboard

This is a follow-up to the excellent [NATS whiteboard](https://github.com/ConnectEverything/nats-whiteboard) example from the Rethink Connectivity video series.

This example demonstrates how to leverage Synadia Control Plane to build a multi-tenant whiteboard.

Topics covered include:
* NATS `account_token_position` for authorization
* NATS `Nats-Request-Info` header for identity
* Control Plane API for provisioning
* ...and more!


---

### How it works

The UI is built using [Excalidraw's SDK](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/installation) for the whiteboard.
The [nats.js](https://github.com/nats-io/nats.js/) library is used to create a NATS websocket connection to Synadia Cloud / NGS.
A Go service is running connected to a "service" Account.
When a new user signs up, they must provide a Synadia Control Plane service token.
The token is used to create an Account with subject imports from the service account into their account.

Users can save whiteboards to files stored in NATS Object Store.
They can share these files with other users using subject / stream exports.
