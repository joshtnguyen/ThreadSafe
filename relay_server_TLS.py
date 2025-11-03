"""
TLS Relay Server - Port 5001
Handles real-time encrypted message routing without decryption capability.
Zero-knowledge relay server for end-to-end encrypted messaging.
"""
from flask import Flask, request
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room

app = Flask(__name__)
app.config['SECRET_KEY'] = 'websocket-relay-secret'
CORS(app, resources={r"/*": {"origins": "*"}})

socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

# Track connected users: {user_id: session_id}
connected_users = {}


@socketio.on('connect')
def handle_connect():
    """Client connected to WebSocket."""
    print(f'Client connected: {request.sid}')
    emit('connected', {'message': 'Connected to relay server'})


@socketio.on('disconnect')
def handle_disconnect():
    """Client disconnected from WebSocket."""
    # Remove from connected users
    user_id = None
    for uid, sid in list(connected_users.items()):
        if sid == request.sid:
            user_id = uid
            del connected_users[uid]
            break
    print(f'Client disconnected: {request.sid} (user {user_id})')


@socketio.on('authenticate')
def handle_authenticate(data):
    """Authenticate user and register their connection."""
    user_id = data.get('userId')
    if user_id:
        connected_users[user_id] = request.sid
        join_room(f'user_{user_id}')
        print(f'User {user_id} authenticated and joined room')
        emit('authenticated', {'userId': user_id})


@socketio.on('new_message')
def handle_new_message(data):
    """
    Relay a new message to the recipient.
    Data: {receiverId, message}
    """
    receiver_id = data.get('receiverId')
    message = data.get('message')

    if receiver_id and message:
        # Emit to specific user's room
        socketio.emit('message_received', {'message': message}, room=f'user_{receiver_id}')
        print(f'Message relayed to user {receiver_id}')


@socketio.on('friend_request')
def handle_friend_request(data):
    """
    Notify a user of a new friend request.
    Data: {recipientId, request}
    """
    recipient_id = data.get('recipientId')
    request_data = data.get('request')

    if recipient_id and request_data:
        socketio.emit('friend_request_received', {'request': request_data}, room=f'user_{recipient_id}')
        print(f'Friend request sent to user {recipient_id}')


@socketio.on('friend_request_accepted')
def handle_friend_request_accepted(data):
    """
    Notify a user that their friend request was accepted.
    Data: {requesterId, friend}
    """
    requester_id = data.get('requesterId')
    friend_data = data.get('friend')

    if requester_id and friend_data:
        socketio.emit('friend_request_accepted_event', {'friend': friend_data}, room=f'user_{requester_id}')
        print(f'Friend acceptance notification sent to user {requester_id}')


@socketio.on('friend_deleted')
def handle_friend_deleted(data):
    """
    Notify a user that they were removed as a friend.
    Data: {friendId, deleter}
    """
    friend_id = data.get('friendId')
    deleter_data = data.get('deleter')

    if friend_id and deleter_data:
        socketio.emit('friend_deleted_event', {'deleter': deleter_data}, room=f'user_{friend_id}')
        print(f'Friend deletion notification sent to user {friend_id}')


@app.route('/health')
def health():
    """Health check endpoint."""
    return {'status': 'ok', 'connected_users': len(connected_users)}, 200


if __name__ == '__main__':
    print('Starting TLS Relay Server on port 5001...')
    socketio.run(app, host='0.0.0.0', port=5001, debug=True)
