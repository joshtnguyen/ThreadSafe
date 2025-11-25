# CMPE-131-Term-Project  
## Name of Application:
**ThreadSafe: A Secure E2EE Web Messaging Application**  

## Overview:
A secure, scalable messaging platform implementing true end-to-end encryption (E2EE) for plaintext and image messaging, both 1-to-1 and group chat conversations. Group chats have role status permission control and settings based around profile editing and notifications. Messages also have receipt status, and contacts management with adding, removing, and editing other friend users. Built with Flask backend and modern web frontend, this application ensures message privacy through advanced cryptographic protocols that include Elliptic Curve Cryptography (ECC), AES-256 symmetric encryption, and the Double Ratchet algorithm for perfect forward secrecy.

## Key Features:
    
- **Advanced Encryption:** Utilizes ECC for asymmetric keys and AES-256 symmetric encryption with HMAC verification
- **Double Ratchet Protocol:** Provides perfect forward secrecy and break-in recovery for one-on-one chats
- **Secure Group Messaging:** A dedicated key server generates ephemeral symmetric keys for group communications
- **Message Persistence Controls:** Auto-deletion features (3 days for one-on-one chats, 24 hours for group chats) with client-side backup and restore options
- **Read Receipts & Status Indicators:** Real-time tracking of message statuses (Sent/Delivered/Read)
- **Contact Management:** Add, remove, edit, and block contacts with a built-in verification system
- **Role-Based Group Permissions:** Hierarchical permissions for Owner, Admin, and Member roles
- **Cross-Platform Sessions:** Device-aware session management with remote revocation capabilities

## Architecture
### Multi-Component Design
- **Main Application Server** (Flask, Port 5000): Manages authentication, REST APIs, and serves the frontend
- **WebSocket Relay Server** (Flask-SocketIO, Port 5001): Zero-knowledge relay for real-time encrypted message routing without decryption capability
- **Message Cleanup Scheduler** (APScheduler): Automated message expiration and deletion based on configurable retention policies
- **Frontend Dev Server** (Vite, Port 5173): Development server with hot module replacement (production builds are served by main server)

## Quick Start (Docker - Recommended)
```bash
# Clone and run with a single command (requires Docker Desktop)
git clone git@github.com:joshtnguyen/CMPE-131-Term-Project.git
cd CMPE-131-Term-Project
docker-compose up
```

##### Access at: [http://localhost:5000](http://localhost:5000)

## Installation & Setup

### Prerequisites
- Python 3.8+
- Node.js 16+ and npm
- Git

### Step 1: Clone the Repository
```bash
git clone git@github.com:joshtnguyen/CMPE-131-Term-Project.git
cd CMPE-131-Term-Project
```

### Step 2: Set Up Python Virtual Environment
```bash
python3 -m venv .venv    # (or try python -m venv .venv)
```

Activate the virtual environment:
- **Windows:**
  ```bash
  .venv\Scripts\activate
  ```
- **MacOS/Linux:**
  ```bash
  source .venv/bin/activate
  ```

### Step 3: Install Backend Dependencies
```bash
pip install -r requirements.txt
```

**Note:** If upgrading an existing database, run this migration script to add new encryption columns:
```bash
python scripts/upgrade_message_schema.py
```

### Step 4: Install Frontend Dependencies
```bash
cd frontend
npm install
cd ..
```

### Step 5: Run the Application

**You need 4 terminal windows running simultaneously.**

My recommendation: in VS Code, open a terminal (Command+j for Mac) then press the "Split Terminal" icon in the top right of the terminal. All terminals should be in the project root folder `/CMPE-131-Term-Project`.

**Optional:** Set environment variables if you encounter connection issues:
```bash
# Unix/macOS (bash/zsh)
export FRONTEND_ORIGIN=http://localhost:5173
export RELAY_API_URL=http://localhost:5001
export RELAY_API_TOKEN=dev-relay-token

# Windows (PowerShell)
$env:FRONTEND_ORIGIN="http://localhost:5173"
$env:RELAY_API_URL="http://localhost:5001"
$env:RELAY_API_TOKEN="dev-relay-token"
```

**Terminal 1 - Main Backend Server (Port 5000):**
```bash
source .venv/bin/activate    # Windows: .venv\Scripts\activate
python run.py
```

**Terminal 2 - WebSocket Relay Server (Port 5001):**
```bash
source .venv/bin/activate    # Windows: .venv\Scripts\activate
python relay_server_TLS.py
```

**Terminal 3 - Message Cleanup Scheduler:**
```bash
source .venv/bin/activate    # Windows: .venv\Scripts\activate
python scheduler.py
```

**Terminal 4 - Frontend Dev Server (Port 5173):**
```bash
cd frontend
npm run dev
```

### Step 6: Access the Application
Open your browser and navigate to:
- **Frontend**: [http://localhost:5173](http://localhost:5173)
- **Backend API**: [http://localhost:5000](http://localhost:5000)
- **Relay Server Health**: [http://localhost:5001/health](http://localhost:5001/health)

Command+click (Mac) or Ctrl+click (Windows) on the links to open them.

## Key Features Testing
### Encryption Protocol Validation
- Verify Double Ratchet algorithm implementation for one-on-one messaging
- Test perfect forward secrecy by simulating key compromises
- Validate group key generation and rotation on membership changes
- Verify HMAC integrity protection against message tampering

### User Account Management
- Test registration with email validation and password strength requirements
- Verify login functionality using both email and username credentials
- Validate session management and token revocation capabilities

### Messaging System
- Test end-to-end encryption for both text and image messages
- Verify real-time message delivery status (Sent/Delivered/Read)
- Validate group chat permissions and admin functionality
- Test message persistence and auto-deletion timers

### Security Features
- Verify contact blocking and management system
- Test backup/restore functionality with client-side encryption
- Validate read receipt toggle functionality
- Test cross-device session management and revocation

## Team Members
### Team Member 1: Josh Nguyen (Project Manager)
- Defined project scope and feature requirements
- Prioritized development tasks and managed the product backlog
- Coordinated between technical and non-technical stakeholders
- Ensured the final product aligned with user needs and security requirements

### Team Member 2: Tanquang Tran (Product Marketing Manager)
- Developed user personas and market positioning strategy
- Created documentation and user onboarding materials
- Designed security feature explanations for non-technical users
- Developed go-to-market strategy and competitive analysis

### Team Member 3: Richard Pham (System Architect)
- Designed the three-server microservices architecture
- Selected and implemented encryption protocols (ECC, AES-256, Double Ratchet)
- Established API contracts between frontend and backend services
- Designed scalable infrastructure patterns for message routing and key management

### Team Member 4: Alvin Cheng (Frontend and Back-end Developer)
- Created a comprehensive ER diagram and database schema
- Implemented MySQL database with full relational integrity
- Developed backend logic using the Python Flask framework
- Ensured domain constraints and referential integrity on foreign keys
- Implemented an authentication system and session management

### Team Member 5: Malcom Dyer (Frontend and Back-end Developer)
- Built a responsive user interface with modern HTML5/CSS3
- Implemented client-side encryption logic in JavaScript
- Developed a real-time chat interface with WebSocket integration
- Created settings and preferences management system
- Implemented local backup/restore functionality

### Team Member 6: Minh Trinh (QA Test Engineer)
- Developed comprehensive test plans for all security features
- Conducted penetration testing on encryption implementation
- Verified cross-browser compatibility and responsive design
- Tested message persistence and auto-deletion functionality
- Validated group chat permissions and role-based access control
- Performed load testing on the WebSocket relay server

### Team Member 7: Elijah Miguel Canonigo (QA Test Engineer)
- Developed comprehensive test plans for all security features
- Conducted penetration testing on encryption implementation
- Verified cross-browser compatibility and responsive design
- Tested message persistence and auto-deletion functionality
- Validated group chat permissions and role-based access control
- Performed load testing on the WebSocket relay server
