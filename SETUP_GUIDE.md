# 🚀 SeaSentinel - Teammate Setup Guide

Welcome to **SeaSentinel**! This guide is written in simple, plain English so any teammate can clone this repository and run the full platform on their computer in less than 3 minutes.

---

## 💻 Prerequisites (Before You Begin)

Make sure you have installed on your computer:
1. **Python 3.10, 3.11, or 3.12+**
   * Download from: [https://www.python.org/downloads/](https://www.python.org/downloads/)
   * *⚠️ Windows Users:* When installing Python, **make sure to check the box: "Add Python to PATH"**!
2. **Git**
   * Download from: [https://git-scm.com/downloads](https://git-scm.com/downloads)

---

## ⚡ Quick Start (Step-by-Step)

### Step 1: Open Your Terminal / Command Prompt
* **Mac:** Press `Cmd + Space`, type `Terminal`, and press `Enter`.
* **Windows:** Press `Win + S`, type `PowerShell` or `cmd`, and press `Enter`.
* **Linux:** Press `Ctrl + Alt + T`.

---

### Step 2: Clone the Repository
Run this command to download the project to your computer:
```bash
git clone https://github.com/Pratyush-Singh-007/YOUR_REPO_NAME.git
cd YOUR_REPO_NAME
```
*(Replace `YOUR_REPO_NAME` with the exact repository name).*

---

### Step 3: Create & Activate a Virtual Environment

#### On macOS & Linux:
```bash
python3 -m venv .venv
source .venv/bin/activate
```

#### On Windows (PowerShell):
```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
```
*(If you see an execution policy error on Windows, run: `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` and try activating again).*

#### On Windows (Command Prompt `cmd`):
```cmd
python -m venv .venv
.venv\Scripts\activate.bat
```

> **How to know it worked?** You will see `(.venv)` appear at the start of your terminal line!

---

### Step 4: Install Dependencies
Install the required packages by running:
```bash
pip install -r requirements.txt
```
*(This takes about 30–60 seconds).*

---

### Step 5: Start the Server!
Run the main server command:
```bash
python main.py
```
*(On Mac/Linux, you can also simply run: `./run.sh`)*

---

### Step 6: Open the Platform in Your Browser
Once the terminal says:
```
INFO: Uvicorn running on http://0.0.0.0:8000
```
Open your web browser (Chrome, Edge, Safari) and go to:

👉 **[http://localhost:8000](http://localhost:8000)**

That's it! You should see the full SeaSentinel C4ISR Tactical Radar & AIS Intelligence interface active on your screen!

---

## 🧪 How to Verify Everything is Working

To verify all test suites and physics calculations on your machine, open a new terminal tab and run:
```bash
pytest tests/test_pipeline.py
```
You should see:
```
============================== 9 passed in 1.20s ==============================
```

---

## ❓ Frequently Asked Questions & Troubleshooting

### Q1: It says `Address already in use` on port 8000!
* **Reason:** Another server or instance is already running on port 8000.
* **Fix:** You can either stop that process, or run SeaSentinel on a different port:
  ```bash
  python main.py --port 8080
  ```
  Then open `http://localhost:8080` in your browser.

### Q2: I see `python: command not found`
* On Mac/Linux, type `python3` instead of `python`.
* On Windows, reinstall Python from [python.org](https://www.python.org) and make sure to check **"Add Python to PATH"**.

### Q3: Do I need internet while using the app?
* **No!** All demo satellite SAR scenes, metocean velocity fields, and AIS traffic data are pre-packaged and cached inside the repository. SeaSentinel can run completely offline.
