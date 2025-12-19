from flask import Flask, request, jsonify, render_template
import subprocess
import os
import tempfile
import base64
from flask_cors import CORS
import re
import pandas as pd
import logging
logging.basicConfig(level=logging.INFO)


# Initialize Flask app and enable CORS
app = Flask(__name__)
CORS(app)

@app.route('/')
def index():
    return render_template('index.html')

current_dir = os.path.abspath(os.path.dirname(__file__))
# Path to the compiled executable for OneStopParallel
OSP_EXECUTABLE_PATH = os.path.join(current_dir, "third_party", "OneStopParallel", "build", "apps", "osp")

# Function to parse stdout log into a JSON-compatible dictionary
def create_stdout_json(log_text):
    # Extract relevant lines from the log output
    match = re.search(r"Number of Vertices:.*?\n([\s\S]*)", log_text)
    relevant_lines = match.group(1).strip().split("\n") if match else []
    
    # Regex pattern to match data in each relevant line
    pattern = re.compile(
        r"total costs:\s*(\d+)\s+work costs:\s*(\d+)\s+comm costs:\s*(\d+)\s+"
        r"number of supersteps:\s*(\d+)\s+compute time:\s*(\d+)ms\s+scheduler:\s*(\S+)"
    )

    # Extract data for each matching line and store it in a list
    data = []
    for line in relevant_lines:
        match = pattern.search(line)
        if match:
            total_costs, work_costs, comm_costs, supersteps, compute_time, scheduler = match.groups()
            data.append([
                scheduler, total_costs, supersteps, work_costs, comm_costs, compute_time
            ])
    
    # Convert extracted data into a pandas DataFrame and return it as a dictionary
    df = pd.DataFrame(data, columns=[
        "Scheduler", "Total Costs", "Supersteps", "Work Costs", "Comm Costs", "Compute Time (ms)"
    ])
    return df.to_dict(orient='records')

@app.before_request
def log_request():
    logging.info(f"Request received: {request.path}")

# Route to handle the running of the OneStopParallel executable
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB per file
MAX_TIME_LIMIT = 600

@app.route('/run', methods=['POST'])
def run_cpp_program():
    timed_out = 0
    try:
        input_dag = request.files['inputDag']
        input_machine = request.files['inputMachine']

        # Check if file size exceeds the limit
        if input_dag and len(input_dag.read()) > MAX_FILE_SIZE:
            return jsonify({'error': 'DAG file exceeds the 10 MB limit'}), 400
        if input_machine and len(input_machine.read()) > MAX_FILE_SIZE:
            return jsonify({'error': 'Machine file exceeds the 10 MB limit'}), 400

        # Reset file pointers after reading
        input_dag.seek(0)
        input_machine.seek(0)

        scheduler = request.form.getlist('scheduler[]')

        # Use 60 seconds if timeLimit is missing/empty/invalid
        time_limit_raw = request.form.get('timeLimit')

        try:
            if time_limit_raw is None or str(time_limit_raw).strip() == '':
                time_limit = 60
            else:
                time_limit = int(time_limit_raw)
        except (ValueError, TypeError):
            time_limit = 60  # fallback if parsing fails

        # clamp to [1, MAX_TIME_LIMIT]
        time_limit = min(MAX_TIME_LIMIT, max(1, time_limit))

        logging.info(f"⏳ Schedulers: {scheduler}, Time Limit: {time_limit}")
        with tempfile.TemporaryDirectory() as temp_dir:
            upload_folder = os.path.join(temp_dir, 'uploads')
            os.makedirs(upload_folder, exist_ok=True)

            input_dag_path = os.path.join(upload_folder, input_dag.filename)
            input_machine_path = os.path.join(upload_folder, input_machine.filename)
            input_dag.save(input_dag_path)
            input_machine.save(input_machine_path)

            logging.info(f"Saved DAG to: {input_dag_path}")
            logging.info(f"Saved Machine to: {input_machine_path}")

            schedulers = []
            for sched in scheduler:
                output_filename = f"{os.path.splitext(input_dag.filename)[0]}_{os.path.splitext(input_machine.filename)[0]}_{sched}_schedule.txt"
                schedulers.append(output_filename)

            command = [
                OSP_EXECUTABLE_PATH,
                '--inputDag', input_dag_path,
                '--inputMachine', input_machine_path,
                '--output'
            ] + [f'--{sched}' for sched in scheduler]

            logging.info(f"Running command: {' '.join(command)}")

            try:
                result = subprocess.run(
                    command,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    timeout=float(time_limit),
                    cwd=temp_dir
                )
                logging.info(f"Command completed with return code: {result.returncode}")
                logging.info(f"STDOUT:\n{result.stdout}")
                logging.info(f"STDERR:\n{result.stderr}")
            except subprocess.TimeoutExpired:
                logging.warning("Command timed out!")
                timed_out = 1
                raise  # re-raise to catch in general exception block

            if result.returncode != 0:
                logging.error("Executable returned non-zero code.")
                return jsonify({
                    'error': result.stderr,
                    'stdout': result.stdout,
                    'stderr': result.stderr
                }), 500

            df_json = create_stdout_json(result.stdout)
            logging.info(f"Parsed stdout to JSON with {len(df_json)} records")

            all_outputs_exist = all(os.path.exists(os.path.join(temp_dir, f)) for f in schedulers)
            if not all_outputs_exist:
                logging.error("⚠️ One or more output files missing.")
                return jsonify({
                    'error': 'At least one output file was not generated',
                    'stdout': result.stdout,
                    'stderr': result.stderr
                }), 500

            file_contents = []
            file_names = []
            for output_filename in schedulers:
                full_path = os.path.join(temp_dir, output_filename)
                logging.info(f"Reading output file: {full_path}")
                with open(full_path, 'rb') as f:
                    output_content = f.read()
                file_contents.append(base64.b64encode(output_content).decode('utf-8'))
                file_names.append(output_filename)

            return jsonify({
                'stdout': df_json,
                'stderr': result.stderr,
                'file_content': file_contents,
                'file_name': file_names
            }), 200

    except Exception as e:
        logging.exception("Unexpected error occurred in /run")
        if timed_out:
            return jsonify({
                'error': '',
                'stdout': '',
                'stderr': 'Scheduling Timed Out!'
            }), 500
        return jsonify({
            'error': str(e),
            'stdout': '',
            'stderr': ''
        }), 500

# Run the Flask app
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
