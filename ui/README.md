# Shared UI space

App-specific screens live next to each app under `apps/<id>/ui`. This directory contains only small browser-shared UI assets such as `styles.css`; it has no app routes, schemas, or runtime logic. The Gateway serves it as a static public root, while the Launcher and apps may use it without importing each other's code.
