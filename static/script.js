// Run everything only after the HTML document has been parsed
document.addEventListener("DOMContentLoaded", function () {
  /***********************
   * Helper functions
   ***********************/

  /**
   * showAlert(message, className)
   * Show a temporary alert banner in the UI.
   * - message: text to display
   * - className: CSS class for styling (e.g., "error-alert")
   */
  function showAlert(message, className) {
    const alertMessage = document.getElementById("alert-message");
    if (!alertMessage) return; // If no alert element, fail silently
    alertMessage.className = 'alert ' + className;
    alertMessage.textContent = message;
    alertMessage.style.display = 'block';
    // Hide after 12 seconds
    setTimeout(() => { alertMessage.style.display = 'none'; }, 12000);
  }

  /**
   * base64ToBlob(base64, mimeType)
   * Convert Base64-encoded text into a binary Blob so we can download it.
   */
  function base64ToBlob(base64, mimeType) {
    const byteCharacters = atob(base64); // Decode Base64 into raw characters
    const byteArrays = [];
    // Process in chunks to avoid blocking on very large files
    for (let offset = 0; offset < byteCharacters.length; offset += 1024) {
      const slice = byteCharacters.slice(offset, offset + 1024);
      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) byteNumbers[i] = slice.charCodeAt(i);
      byteArrays.push(new Uint8Array(byteNumbers));
    }
    return new Blob(byteArrays, { type: mimeType });
  }

  /***********************
   * Cached DOM references
   * (Avoid re-querying the DOM repeatedly)
   ***********************/
  const schedulerListUL = document.getElementById("scheduler-list");          // The dropdown list <ul>
  const modalDescUL     = document.getElementById("scheduler-descriptions");  // List of schedulers in modal
  const dropdownMenuEl  = document.querySelector(".dropdown-menu");           // Actual dropdown container
  const dropdownBtn     = document.getElementById("multiSelectDropdown");     // Button showing selection

  // Wizard UI
  const stepDiv   = document.getElementById("wizard-step");
  const prevBtn   = document.getElementById("wizard-prev");
  const nextBtn   = document.getElementById("wizard-next");
  const resultDiv = document.getElementById("wizard-result");

  // Form + progress
  const formEl = document.getElementById("osp-form");
  const spinner = document.getElementById("loading-spinner");
  const mainDownloadBtn = document.getElementById("download-button");

  // Keep original dropdown text so we can restore it any time
  const initialDropdownText = dropdownBtn ? dropdownBtn.innerText : "Select Schedulers";
  function keepDropdownText() { if (dropdownBtn) dropdownBtn.innerText = initialDropdownText; }
  // Expose to global scope in case other code wants to reset the label
  window.updateSchedulerDropdownText = keepDropdownText;

  // Prevent the dropdown from closing when clicking inside it
  if (dropdownMenuEl) dropdownMenuEl.addEventListener("click", (e) => e.stopPropagation());

  /***********************
   * In-memory state
   ***********************/
  const selectedSchedulers = new Set(); // Tracks which schedulers are checked

  // Wizard state (populated from JSON)
  let QUESTIONS = [];     // Loaded questions from schedulers.json
  let FLAGS_ORDER = [];   // Order of flags (derived from QUESTIONS.flag)
  let currentStep = 0;    // Current wizard step index
  let userAnswers = [];   // Text answers for each step
  let resultVisible = false; // Whether the recommendation panel is shown

  /***********************
   * Load JSON (single source of truth)
   ***********************/
  // Each scheduler looks like:
  // { value, label, desc, when: {FLAG_NAME: 0|1|2, ...} }
  let SCHEDULERS = [];

  fetch("/static/schedulers.json")
    .then(r => r.json())
    .then(data => {
      // Questions define flags and mappings from option text -> numeric flag value
      QUESTIONS = data.questions || [];
      FLAGS_ORDER = QUESTIONS.map(q => q.flag);
      SCHEDULERS = data.schedulers || [];

      // Build UI and wire events
      buildDropdown(SCHEDULERS);
      buildModalList(SCHEDULERS);
      wireFormSubmit();

      // Render first wizard step
      renderWizardStep();
    })
    .catch(err => {
      console.error("Cannot load schedulers.json:", err);
      showAlert("Failed to load schedulers list.", "error-alert");
    });

  /***********************
   * Dropdown + modal lists
   ***********************/

  /**
   * Build the checkbox list for schedulers inside the dropdown.
   */
  function buildDropdown(arr) {
    if (!schedulerListUL) return;
    schedulerListUL.innerHTML = "";
    arr.forEach(({ value, label }) => {
      const li = document.createElement("li");
      li.innerHTML =
        `<label class="px-3 py-1 w-100 d-block">
           <input type="checkbox" value="${value}">
           <span>${label}</span>
         </label>`;
      schedulerListUL.appendChild(li);
    });

    // Restore checked state and listen for changes
    schedulerListUL.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.checked = selectedSchedulers.has(cb.value);
      cb.addEventListener("change", () => {
        if (cb.checked) selectedSchedulers.add(cb.value);
        else selectedSchedulers.delete(cb.value);
        keepDropdownText(); // Keep button text static (not a summary of selections)
      });
    });

    keepDropdownText();
  }

  /**
   * Build the scheduler description list inside the modal.
   */
  function buildModalList(arr) {
    if (!modalDescUL) return;
    modalDescUL.innerHTML = "";
  
    // Sort OSP first, Classic last
    const sorted = [...arr].sort((a, b) => {
      return (a.classic === b.classic) ? 0 : a.classic ? 1 : -1;
    });
  
    let currentGroup = null;
  
    sorted.forEach(({ label, desc, classic }) => {
      const groupName = classic ? "Classic Schedulers" : "OSP Schedulers";
  
      // Add group heading if group changes
      if (groupName !== currentGroup) {
        currentGroup = groupName;
        const heading = document.createElement("div");
        heading.textContent = groupName;
        heading.style.fontWeight = "bold";
        heading.style.marginTop = currentGroup === "OSP Schedulers" ? "0" : "1rem";
        heading.style.marginBottom = "0.4rem";
        heading.style.fontSize = "1.05rem";
        heading.style.color = "#333";
        heading.style.marginLeft = "0"; // fully left aligned
        modalDescUL.appendChild(heading);
      }
  
      // Add scheduler description as a list item
      const li = document.createElement("li");
      li.style.listStyleType = "disc";
      li.style.marginLeft = "1.5rem"; // indent items, not headings
      li.innerHTML = `<strong>${label}</strong>: ${desc}`;
      modalDescUL.appendChild(li);
    });
  }
  
  

  /***********************
   * Apply recommendations (accepts 1 or many)
   * This checks the relevant checkboxes in the dropdown.
   ***********************/
  window.applyRecommendedScheduler = function (names) {
    const list = Array.isArray(names) ? names : [names];

    // Reset current selection
    selectedSchedulers.clear();
    if (schedulerListUL) {
      // Uncheck all first
      schedulerListUL.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
      // Check recommended ones
      list.forEach(name => {
        // CSS.escape ensures special characters in value don't break the selector
        const cb = schedulerListUL.querySelector(
          `input[type="checkbox"][value="${CSS.escape(name)}"]`
        );
        if (cb) {
          cb.checked = true;
          selectedSchedulers.add(name);
        } else {
          console.warn("Checkbox not found for scheduler:", name);
        }
      });
    }
    keepDropdownText();
  };

  /***********************
   * Form submit handler
   ***********************/
  function wireFormSubmit() {
    if (!formEl) return;

    formEl.addEventListener("submit", async function (event) {
      event.preventDefault(); // Prevent page reload

      // Pull the two input files (if any)
      const dagInput = document.getElementById("inputDag");
      const machineInput = document.getElementById("inputMachine");
      const dagFile = dagInput?.files?.[0] || null;
      const machineFile = machineInput?.files?.[0] || null;

      // Enforce file size limit
      const MAX_FILE_SIZE_MB = 50;
      const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;
      if ((dagFile && dagFile.size > MAX_FILE_SIZE) || (machineFile && machineFile.size > MAX_FILE_SIZE)) {
        alert(`Each input file must be smaller than ${MAX_FILE_SIZE_MB} MB.`);
        return;
      }

      const formData = new FormData(this);

      // Require at least one scheduler
      if (selectedSchedulers.size === 0) {
        showAlert("Please select at least one scheduler.", "error-alert");
        return;
      }

      // Replace any existing scheduler fields with the selected set (scheduler[])
      formData.delete("scheduler");
      formData.delete("scheduler[]");
      for (const s of selectedSchedulers) formData.append("scheduler[]", s);

      // Create a base name from the two input filenames, used when downloading outputs
      const inputDag = formData.get("inputDag");
      const inputMachine = formData.get("inputMachine");
      let concatenatedName = "unknown_filename";
      if (inputDag?.name && inputMachine?.name) {
        const dagName = inputDag.name.replace(/\.[^/.]+$/, "");      // strip extension
        const machineName = inputMachine.name.replace(/\.[^/.]+$/, "");
        concatenatedName = `${dagName}_${machineName}`;
      }

      // Show the spinner while backend runs; hide the main download button until we have results
      if (spinner) spinner.style.display = "block";
      if (mainDownloadBtn) mainDownloadBtn.style.display = "none";

      try {
        // Send the request to backend
        const response = await fetch("/run", { method: "POST", body: formData });
        if (!response.ok) {
          // Try to surface a useful error, prefer server-provided stderr if available
          let errorMessage = `Error: ${response.status} ${response.statusText}`;
          try {
            const errorData = await response.json();
            if (errorData?.stderr) errorMessage = errorData.stderr;
          } catch {}
          showAlert(errorMessage, "error-alert");
          return;
        }

        // Expect JSON containing: stdout (table rows), file_content (array of base64 schedules), file_name (names)
        const data = await response.json();
        if (Array.isArray(data.file_content)) {
          displayTable(data.stdout, data.file_content, data.file_name, concatenatedName);
        } else {
          showAlert("Error: Unexpected file content format.", "error-alert");
        }
      } catch (err) {
        console.error("Request error:", err);
        showAlert("Request failed. Check console for details.", "error-alert");
      } finally {
        if (spinner) spinner.style.display = "none";
      }
    });
  }

  /***********************
   * Results table (sortable)
   * Renders rows and supports click/keyboard sorting.
   ***********************/
  function displayTable(tableData, fileContents, fileNames, concatenatedName) {
    const tableContainer = document.getElementById("table-container");
    const rightContainer = document.querySelector(".right-container");
    if (!tableContainer || !rightContainer) return;

    // Ensure the right panel is visible (CSS sets it hidden by default)
    rightContainer.style.display = "block";
    tableContainer.innerHTML = "";

    // If no data, say so and bail out
    if (!tableData || tableData.length === 0) {
      tableContainer.innerHTML = "<p>No table data available.</p>";
      return;
    }

    // Column order and which ones can be sorted
    const columnOrder = [
      "Scheduler", "Total Costs", "Supersteps", "Work Costs", "Comm Costs", "Compute Time (ms)", "Download Schedule"
    ];
    const sortableColumns = new Set([
      "Scheduler", "Total Costs", "Supersteps", "Work Costs", "Comm Costs", "Compute Time (ms)"
    ]);

    // Helpers to normalize values for sorting (numeric vs string)
    const toNumber = (val) => {
      if (val == null) return NaN;
      if (typeof val === "number") return val;
      const s = String(val).replace(/,/g, "").replace(/[^\d.\-+eE]/g, "");
      const n = parseFloat(s);
      return Number.isNaN(n) ? NaN : n;
    };
    const toStringKey = (val) => (val == null ? "" : String(val)).trim().toLocaleLowerCase();

    // Copy table data so we can reorder without mutating original
    let rows = [...tableData];
    let currentSort = { key: null, dir: null }; // e.g., { key: "Total Costs", dir: "asc" }

    // Build table elements
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    const thByKey = new Map();

    // Build header cells, mark sortable ones
    columnOrder.forEach(column => {
      const th = document.createElement("th");
      th.textContent = column;
      if (sortableColumns.has(column)) {
        th.dataset.key = column;
        th.classList.add("sortable");
        th.setAttribute("tabindex", "0");       // keyboard focusable
        th.setAttribute("aria-sort", "none");   // for screen readers
      }
      thByKey.set(column, th);
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement("tbody");
    table.appendChild(tbody);

    /**
     * Render all table rows into <tbody>.
     * Also wires the "Download" buttons for each row.
     */
    function renderBody() {
      tbody.innerHTML = "";
      rows.forEach((rowData) => {
        const tr = document.createElement("tr");
        const schedulerName = rowData["Scheduler"] || "Unknown";
        const fullFileName = `${concatenatedName}_${schedulerName}_schedule.txt`;
        // Find schedule content for this scheduler by matching filename array entry
        const fileIndex = fileNames.findIndex(fileName => fileName.includes(schedulerName));

        columnOrder.forEach(column => {
          const td = document.createElement("td");

          if (column === "Download Schedule") {
            // Create a "Download" button that saves the schedule file
            const btn = document.createElement("button");
            btn.textContent = "Download";
            btn.classList.add("download-btn");
            btn.onclick = function () {
              if (fileIndex < 0) {
                alert("Schedule file not found for this scheduler.");
                return;
              }
              const a = document.createElement("a");
              const blob = base64ToBlob(fileContents[fileIndex], "text/plain");
              const url = window.URL.createObjectURL(blob);
              a.href = url;
              a.download = fullFileName;
              a.style.display = "none";
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              window.URL.revokeObjectURL(url);
            };
            td.appendChild(btn);
          } else {
            // Normal data cell
            td.textContent = rowData[column] ?? "";
          }

          tr.appendChild(td);
        });

        tbody.appendChild(tr);
      });
    }

    /**
     * Update visual sort indicators on headers (CSS classes + aria-sort)
     */
    function updateHeaderIndicators() {
      thByKey.forEach((th, key) => {
        th.classList.remove("sorted-asc", "sorted-desc");
        if (sortableColumns.has(key)) th.setAttribute("aria-sort", "none");
      });
      if (!currentSort.key) return;
      const th = thByKey.get(currentSort.key);
      if (!th) return;
      th.classList.add(currentSort.dir === "asc" ? "sorted-asc" : "sorted-desc");
      th.setAttribute("aria-sort", currentSort.dir === "asc" ? "ascending" : "descending");
    }

    /**
     * Sort rows by key (column) and direction (asc/desc), then re-render.
     * For strings: case-insensitive A–Z
     * For numbers: treat NaN as "empty" and push them last.
     */
    function doSort(key, dir) {
      currentSort = { key, dir };
      rows = rows
        .map((r, i) => ({ r, i })) // Keep original index for stable tiebreak
        .sort((a, b) => {
          if (key === "Scheduler") {
            const as = toStringKey(a.r[key]);
            const bs = toStringKey(b.r[key]);
            const aEmpty = as === "";
            const bEmpty = bs === "";
            if (aEmpty && bEmpty) return a.i - b.i;
            if (aEmpty) return 1;
            if (bEmpty) return -1;
            const cmp = as.localeCompare(bs, undefined, { sensitivity: "base" });
            if (cmp !== 0) return dir === "asc" ? cmp : -cmp;
            return a.i - b.i; // stable
          } else {
            const av = toNumber(a.r[key]);
            const bv = toNumber(b.r[key]);
            const aNaN = Number.isNaN(av);
            const bNaN = Number.isNaN(bv);
            if (aNaN && bNaN) return a.i - b.i;
            if (aNaN) return 1;
            if (bNaN) return -1;
            const diff = av - bv;
            if (diff !== 0) return dir === "asc" ? diff : -diff;
            return a.i - b.i; // stable
          }
        })
        .map(o => o.r);

      updateHeaderIndicators();
      renderBody();
    }

    // Click-to-sort
    thead.addEventListener("click", (e) => {
      const th = e.target.closest("th.sortable");
      if (!th) return;
      const key = th.dataset.key;
      let dir = "asc";
      if (currentSort.key === key) dir = currentSort.dir === "asc" ? "desc" : "asc";
      doSort(key, dir);
    });

    // Keyboard sorting support (Enter/Space)
    thead.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const th = e.target.closest("th.sortable");
        if (!th) return;
        const key = th.dataset.key;
        let dir = "asc";
        if (currentSort.key === key) dir = currentSort.dir === "asc" ? "desc" : "asc";
        doSort(key, dir);
      }
    });

    // Initial render + default sort
    renderBody();
    tableContainer.appendChild(table);
    doSort("Total Costs", "asc");
  }

  /***********************
   * Wizard: map answers -> flags, find matches, render UI
   ***********************/

  /**
   * answersToFlagValues(answers)
   * For each question, map the selected text answer to a numeric flag using q.map.
   * If an answer is unknown or missing, default to 2 ("Any").
   */
  function answersToFlagValues(answers) {
    const out = {};
    QUESTIONS.forEach((q, idx) => {
      const ans = answers[idx];
      const m = q.map || {};
      out[q.flag] = (ans in m) ? m[ans] : 2; // 2 = Any
    });
    return out;
  }

  /**
   * flagsMatch(recFlags, algoFlags)
   * Return true if all flags are compatible:
   * - Exact match OR
   * - Either side is 2 ("Any")
   */
  function flagsMatch(recFlags, algoFlags) {
    for (const f of FLAGS_ORDER) {
      const r = recFlags[f];
      const a = algoFlags[f];
      if (!(r === a || r === 2 || a === 2)) return false;
    }
    return true;
  }

  /**
   * findMatchingAlgorithms(recFlags)
   * Filter SCHEDULERS whose `when` flags match the user's preferences.
   */
  function findMatchingAlgorithms(recFlags) {
    return SCHEDULERS.filter(algo => flagsMatch(recFlags, algo.when || {}));
  }

  /**
   * recommendSchedulers(recFlags)
   * Return labels of matching algorithms, or fallback to "GrowLocal" if none.
   */
  function recommendSchedulers(recFlags) {
    const matches = findMatchingAlgorithms(recFlags);
    return matches.length ? matches.map(a => a.label) : ["GrowLocal"];
  }

  /**
   * Render the current step of the wizard (or the results panel when finished).
   */
  function renderWizardStep() {
    if (!stepDiv || !prevBtn || !nextBtn || !resultDiv) return;

    const LAST_STEP = QUESTIONS.length - 1;
    const q = QUESTIONS[currentStep];

    // Build the step UI with radio buttons for each option
    stepDiv.innerHTML = `
      <h6>Step ${currentStep + 1} of ${QUESTIONS.length}</h6>
      <p class="mb-2">${q.text}</p>
      ${q.options.map(opt => `
        <div>
          <input type="radio" name="wizard-answer" value="${opt}"
                 id="wizard-${currentStep}-${opt}"
                 ${userAnswers[currentStep] === opt ? 'checked' : ''}>
          <label for="wizard-${currentStep}-${opt}">${opt}</label>
        </div>
      `).join("")}
    `;

    // Prev disabled on first step
    prevBtn.disabled = currentStep === 0;

    // If we reached the last step and results are visible, hide the step and show results
    if (currentStep === LAST_STEP && resultVisible) {
      stepDiv.classList.add("d-none");
      resultDiv.classList.remove("d-none");
      nextBtn.textContent = "Reset";
      nextBtn.classList.add("reset-btn");
    } else {
      stepDiv.classList.remove("d-none");
      resultDiv.classList.add("d-none");
      nextBtn.textContent = "Next";
      nextBtn.classList.remove("reset-btn");
    }

    // Wire the Next/Reset button once
    if (!nextBtn._wired) {
      nextBtn.addEventListener("click", () => {
        // If on results screen and user clicks Reset
        if (nextBtn.classList.contains("reset-btn") && resultVisible && currentStep === LAST_STEP) {
          currentStep = 0;
          userAnswers = [];
          hideRecommendation();
          renderWizardStep();
          return;
        }

        // Require an option to proceed
        const selected = document.querySelector('input[name="wizard-answer"]:checked');
        if (!selected) { alert("Please select an option"); return; }

        // Save the answer
        userAnswers[currentStep] = selected.value;

        // Move forward or show results
        if (currentStep < LAST_STEP) {
          currentStep++;
          hideRecommendation(); // Ensure results are hidden until final step
          renderWizardStep();
        } else {
          showRecommendation();
        }
      });
      nextBtn._wired = true;
    }

    // Wire the Prev button once
    if (!prevBtn._wired) {
      prevBtn.addEventListener("click", () => {
        if (currentStep === LAST_STEP && resultVisible) {
          // If we were on results, go back to the question view
          hideRecommendation();
          renderWizardStep();
          return;
        }
        if (currentStep > 0) {
          currentStep -= 1;
          hideRecommendation();
          renderWizardStep();
        }
      });
      prevBtn._wired = true;
    }

    // If answer changes mid-wizard, hide any stale recommendation UI
    if (!stepDiv._wired) {
      stepDiv.addEventListener("change", (e) => {
        if (e.target && e.target.name === "wizard-answer" && currentStep !== LAST_STEP) {
          hideRecommendation();
        }
      });
      stepDiv._wired = true;
    }
  }

  /**
   * Hide recommendation panel and restore "Next" button.
   */
  function hideRecommendation() {
    resultVisible = false;
    if (resultDiv) {
      resultDiv.classList.add("d-none");
      resultDiv.classList.remove("rec-row");
      resultDiv.innerHTML = "";
    }
    stepDiv?.classList.remove("d-none");
    if (nextBtn) {
      nextBtn.classList.remove("reset-btn");
      nextBtn.textContent = "Next";
    }
  }

  /**
   * Compute recommendations and show them as chips with an "Apply All" button.
   */
  function showRecommendation() {
    if (!resultDiv) return;

    // Convert answers to flag values and ask for recommendations
    const recFlags = answersToFlagValues(userAnswers);
    const schedulers = recommendSchedulers(recFlags);

    // Visual chips for recommended schedulers
    const chips = schedulers
      .map(s => `<span class="badge rounded-pill text-bg-light me-2 mb-2" style="border:1px solid #fff;">${s}</span>`)
      .join("");

    // Render results view
    resultDiv.classList.add("rec-row");
    resultDiv.innerHTML = `
      <div class="w-100 text-center">
        <div class="mb-2"><span class="rec-label fw-semibold">💡 Recommended Scheduler(s):</span></div>
        <div class="rec-chips">${chips}</div>
        <button type="button" class="btn btn-chip mt-2" id="apply-schedulers-btn" data-bs-dismiss="modal">
          Apply All
        </button>
      </div>
    `;

    resultDiv.classList.remove("d-none");
    stepDiv?.classList.add("d-none");

    // Turn "Next" into "Reset"
    nextBtn.textContent = "Reset";
    nextBtn.classList.add("reset-btn");

    // When user clicks "Apply All", check those schedulers in the dropdown and close the modal
    const applyBtn = document.getElementById("apply-schedulers-btn");
    if (applyBtn) {
      applyBtn.addEventListener("click", () => {
        window.applyRecommendedScheduler(schedulers);
        const modalEl = document.getElementById("SchedulersModal");
        // Close the modal if Bootstrap is available
        if (modalEl && window.bootstrap && typeof bootstrap.Modal?.getOrCreateInstance === "function") {
          bootstrap.Modal.getOrCreateInstance(modalEl).hide();
        }
      });
    }

    resultVisible = true;
  }

});
