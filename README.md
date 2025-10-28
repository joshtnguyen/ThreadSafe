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
### Three-Server Design
- **Main Application Server** (Flask, Port 5000): Manages authentication, REST APIs, and serves the frontend
- **WebSocket Relay Server** (Flask-SocketIO, Port 5001): Handles TLS-secured message routing without decryption capability
- **Key Generation Server** (Port 5002): A dedicated service for secure group key derivation

## Quick Start (Docker - Recommended)
```bash
# Clone and run with a single command (requires Docker Desktop)
git clone git@github.com:joshtnguyen/CMPE-131-Term-Project.git
cd CMPE-131-Term-Project
docker-compose up
```
### Access at: [http://localhost:5000](http://localhost:5000)

## Manual Setup
### Back-end Setup
1. Clone the repository: 
   ```bash
   git clone git@github.com:joshtnguyen/CMPE-131-Term-Project.git
   ```
2. Navigate to the directory: 
   ```bash
   cd CMPE-131-Term-Project
   ```
3. Set up virtual environment: 
   ```bash
   python3 -m venv venv
   ```
4. Activate virtual environment:
   - Windows: 
     ```bash
     venv\Scripts\activate
     ```
   - MacOS/Linux: 
     ```bash
     source venv/bin/activate
     ```
5. Install dependencies: 
   ```bash
   pip install -r requirements.txt
   ```
6. Database Setup:
   - Start MySQL server: 
     ```bash
     mysql -u root -p
     ```
   - Create database: 
     ```sql
     CREATE DATABASE secure_msg_app;
     ```
   - Import schema: 
     ```bash
     mysql -u root -p secure_msg_app < database/schema.sql
     ```
7. Run the application: 
   ```bash
   python run.py
   ```
8. Access at: [http://localhost:5000](http://localhost:5000)

### Front-end Setup
- The frontend is served directly by the Flask backend
- cd into /frontend then run `npm install`
- then run `npm run dev`

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
### Team Member 1: Josh Nguyen (Product Manager)
- Defined project scope and feature requirements
- Prioritized development tasks and managed the product backlog
- Coordinated between technical and non-technical stakeholders
- Ensured the final product aligned with user needs and security requirements

### Team Member 2: Minh (Product Marketing Manager)
- Developed user personas and market positioning strategy
- Created documentation and user onboarding materials
- Designed security feature explanations for non-technical users
- Developed go-to-market strategy and competitive analysis

### Team Member 3: Richard Pham (System Architect)
- Designed the three-server microservices architecture
- Selected and implemented encryption protocols (ECC, AES-256, Double Ratchet)
- Established API contracts between frontend and backend services
- Designed scalable infrastructure patterns for message routing and key management

### Team Member 4: Alvin Cheng (Back-end Developer)
- Created a comprehensive ER diagram and database schema
- Implemented MySQL database with full relational integrity
- Developed backend logic using the Python Flask framework
- Ensured domain constraints and referential integrity on foreign keys
- Implemented an authentication system and session management

### Team Member 5: Malcom Dyer (Frontend Developer)
- Built a responsive user interface with modern HTML5/CSS3
- Implemented client-side encryption logic in JavaScript
- Developed a real-time chat interface with WebSocket integration
- Created settings and preferences management system
- Implemented local backup/restore functionality

### Team Member 6: QA Test Engineer
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
