"""
Helper module to emit WebSocket events to the relay server.
"""
import socketio

# Create a SocketIO client to connect to relay server
sio = socketio.Client()
RELAY_SERVER_URL = 'http://localhost:5001'

try:
    sio.connect(RELAY_SERVER_URL)
    print(f'✓ Connected to TLS relay server at {RELAY_SERVER_URL}')
except Exception as e:
    print(f'⚠ Could not connect to TLS relay server: {e}')
    print('  Real-time features will not work. Start relay_server_TLS.py on port 5001.')


def emit_new_message(receiver_id: int, message: dict):
    """Emit a new message event to the relay server."""
    try:
        if sio.connected:
            sio.emit('new_message', {
                'receiverId': receiver_id,
                'message': message
            })
    except Exception as e:
        print(f'Error emitting message: {e}')


def emit_friend_request(recipient_id: int, request_data: dict):
    """Emit a friend request notification."""
    try:
        if sio.connected:
            sio.emit('friend_request', {
                'recipientId': recipient_id,
                'request': request_data
            })
    except Exception as e:
        print(f'Error emitting friend request: {e}')


def emit_friend_request_accepted(requester_id: int, friend_data: dict):
    """Emit a friend request accepted notification."""
    try:
        if sio.connected:
            sio.emit('friend_request_accepted', {
                'requesterId': requester_id,
                'friend': friend_data
            })
    except Exception as e:
        print(f'Error emitting friend acceptance: {e}')


def emit_friend_deleted(friend_id: int, deleter_data: dict):
    """Emit a friend deletion notification."""
    try:
        if sio.connected:
            sio.emit('friend_deleted', {
                'friendId': friend_id,
                'deleter': deleter_data
            })
    except Exception as e:
        print(f'Error emitting friend deletion: {e}')


def is_connected():
    """Check if connected to relay server."""
    return sio.connected
