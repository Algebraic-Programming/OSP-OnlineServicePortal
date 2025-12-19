# OneStopParallel Web Interface

First step is to clone the repo and its submodule:
```bash
git clone --recurse-submodules git@ssh.gitlab.huaweirc.ch:zrc-von-neumann-lab/opdas/osp-web-interface.git
```

## Setup

### OneStopParallel installation
```bash
cd third_party/OneStopParallel && mkdir -p build && cd build
cmake ..
make -j$(nproc)
```

### Backend setup
In a terminal run the backend from the base directory:
```bash
python3 backend.py
```

### Running a Local Development Server
To preview the project in a browser, you can start a simple HTTP server:
```bash
python3 -m http.server 8000
```

## Use the application
Open the local host [http://localhost:8000/](http://localhost:8000/)