# OneStopParallel Web Interface

This repository is intended to be deployed on a server as a small Flask web
application for running the
[OneStopParallel](https://github.com/Algebraic-Programming/OneStopParallel)
scheduler through a browser.

Users can:

- upload an input DAG file and a machine description file
- choose one or more schedulers
- run the native `osp` executable through the web UI
- compare scheduling results in a table
- download the generated schedule files

## How It Works

The app has two main parts:

- `backend.py`: Flask application that serves the UI and runs the OSP executable
- `templates/` and `static/`: frontend assets for the upload form, scheduler picker, and results table

At runtime, the backend:

1. receives uploaded input files
2. stores them in a temporary working directory
3. executes the compiled `osp` binary
4. parses the executable output into JSON
5. returns result rows and generated schedule files to the browser

The backend expects the OneStopParallel executable at:

```text
third_party/OneStopParallel/build/apps/osp
```

## Repository Layout

```text
.
├── backend.py
├── templates/
│   └── index.html
├── static/
│   ├── script.js
│   ├── schedulers.json
│   └── styles.css
├── data/
│   └── sample input files
└── third_party/
    └── OneStopParallel/
```

## Requirements

You need:

- Python 3.10+ recommended
- `git`
- `cmake`
- a C++ toolchain capable of building OneStopParallel

Python packages used by the backend:

- `flask`
- `flask-cors`
- `pandas`
- `gunicorn` for production deployment

Example install:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install flask flask-cors pandas gunicorn
```

## Setup

### 1. Clone the repository

Clone the repository together with its submodule:

```bash
git clone --recurse-submodules <your-repo-url>
cd OSP-OnlineServicePortal
```

If you already cloned it without submodules:

```bash
git submodule update --init --recursive
```

### 2. Build OneStopParallel

Build the native executable in the expected location:

```bash
cd third_party/OneStopParallel
mkdir -p build
cd build
cmake ..
make -j"$(nproc)"
```

After a successful build, this file should exist:

```bash
third_party/OneStopParallel/build/apps/osp
```

### 3. Install Python dependencies

From the repository root:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install flask flask-cors pandas gunicorn
```

## Running on a Server

This project is designed to be run on a Linux server, typically behind
Gunicorn and optionally behind a reverse proxy such as Nginx.

### Production with Gunicorn

The Flask app object is exposed as `backend:app`, so Gunicorn should be started
from the repository root.

Example production command:

```bash
gunicorn backend:app \
  --bind 0.0.0.0:8001 \
  --workers 4 \
  --timeout 43200 \
  --daemon \
  --access-logfile access.log \
  --error-logfile error.log \
  --capture-output \
  --log-level info
```

This is a valid way to run the application in production.

Open the application on:

```text
http://<server-host>:8001/
```

### Recommended process management

For a real server deployment, avoid starting Gunicorn manually in an SSH
session. Prefer one of these:

- `systemd`
- `supervisor`
- a container runtime

This ensures the service restarts automatically and logs are managed properly.

### Reverse proxy

In a typical production setup:

- Gunicorn listens on an internal port such as `8001`
- Nginx or Apache listens on `80` or `443`
- the reverse proxy forwards requests to Gunicorn

This is the preferred setup if the application is exposed publicly.

## Local Development

Run the Flask app directly:

```bash
python3 backend.py
```

Then open:

```text
http://localhost:5000/
```

Note: you do not need a separate `python -m http.server`. Flask already serves
the HTML template and static assets for this project.

## Runtime Behavior

### Backend endpoints

- `GET /`: renders the main interface
- `POST /run`: accepts uploaded files and selected schedulers, runs `osp`, and returns JSON results

### Uploaded files

The `/run` endpoint expects:

- `inputDag`: DAG file
- `inputMachine`: machine description file
- `scheduler[]`: one or more scheduler names
- `timeLimit`: optional time limit in seconds

### Limits

Current backend limits in code:

- maximum upload size per file: 50 MB
- maximum scheduling time accepted by the backend: 600 seconds
- default scheduling time if omitted: 60 seconds

Even if Gunicorn allows a much longer request timeout, the application itself
currently clamps the scheduler runtime to at most 600 seconds.

## Input Formats

Supported DAG formats in the UI:

- `.mtx`
- `.dot`
- `.hdag`

Machine file format references are linked directly from the application UI.

## Troubleshooting

### `osp` executable not found

If scheduling fails immediately, check that the executable exists:

```bash
ls -l third_party/OneStopParallel/build/apps/osp
```

If it is missing, initialize the submodule and rebuild OneStopParallel.

### Permission denied when running `osp`

Make sure the executable has the proper permissions:

```bash
chmod +x third_party/OneStopParallel/build/apps/osp
```

### Requests time out

There are two time-related controls:

- Gunicorn timeout
- application-level `timeLimit` handling in `backend.py`

If a user enters a larger value, the backend still caps runtime at 600 seconds.

### Gunicorn starts but scheduling fails

If the web page loads but `/run` fails, the most common causes on a server are:

- the `osp` executable was not built
- the service user does not have permission to execute `osp`
- required input paths or working directories are not writable
- the app was started from the wrong repository directory

Make sure Gunicorn is launched from the project root so `backend.py` resolves:

```bash
backend:app
```

## Notes

- The frontend scheduler list and recommendation wizard are driven by `static/schedulers.json`.
- The backend returns generated schedule files as base64 and the browser converts them back into downloadable text files.
- Each request runs in its own temporary directory, so uploaded files are not stored permanently by the app.

## License

This repository is licensed under the Apache License 2.0. See
[LICENSE](/home/christos/Desktop/OSP-OnlineServicePortal/LICENSE).

If you redistribute or deploy this project, also review the license terms of the
upstream OneStopParallel dependency and any other bundled third-party components.
