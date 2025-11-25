"""
TLS Relay Server - Port 5001
Handles real-time encrypted message routing without decryption capability.
Zero-knowledge relay server for end-to-end encrypted messaging.
"""
import os
from flask import Flask, request, abort, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room

DEFAULT_ORIGINS = [
    os.environ.get("FRONTEND_ORIGIN"),
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
ALLOWED_ORIGINS = [origin for origin in DEFAULT_ORIGINS if origin]

app = Flask(__name__)
app.config['SECRET_KEY'] = 'websocket-relay-secret'
CORS(app, resources={r"/*": {"origins": ALLOWED_ORIGINS or "*"}})

socketio = SocketIO(
    app,
    cors_allowed_origins=ALLOWED_ORIGINS or "*",
    async_mode='eventlet'
)

# Track connected users: {user_id: session_id}
connected_users = {}
API_TOKEN = os.environ.get("RELAY_API_TOKEN", "dev-relay-token")


def _verify_api_request():
    token = request.headers.get("X-Relay-Token")
    if token != API_TOKEN:
        abort(401)
    if request.remote_addr not in {"127.0.0.1", "::1"}:
        abort(403)


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


@app.post('/relay/message')
def relay_message_http():
    _verify_api_request()
    data = request.get_json(silent=True) or {}
    receiver_id = data.get('receiverId')
    message = data.get('message')
    if not receiver_id or not message:
        return jsonify({'message': 'receiverId and message required'}), 400
    socketio.emit('message_received', {'message': message}, room=f'user_{receiver_id}')
    return jsonify({'status': 'ok'}), 200


@app.post('/relay/friend-request')
def relay_friend_request_http():
    _verify_api_request()
    data = request.get_json(silent=True) or {}
    recipient_id = data.get('recipientId')
    request_payload = data.get('request')
    if not recipient_id or not request_payload:
        return jsonify({'message': 'recipientId and request required'}), 400
    socketio.emit('friend_request_received', {'request': request_payload}, room=f'user_{recipient_id}')
    return jsonify({'status': 'ok'}), 200


@app.post('/relay/friend-accepted')
def relay_friend_accepted_http():
    _verify_api_request()
    data = request.get_json(silent=True) or {}
    requester_id = data.get('requesterId')
    friend_data = data.get('friend')
    if not requester_id or not friend_data:
        return jsonify({'message': 'requesterId and friend required'}), 400
    print(f'Emitting friend_request_accepted_event to user_{requester_id} with friend: {friend_data.get("username", "unknown")}')
    socketio.emit('friend_request_accepted_event', {'friend': friend_data}, room=f'user_{requester_id}')
    return jsonify({'status': 'ok'}), 200


@app.post('/relay/friend-deleted')
def relay_friend_deleted_http():
    _verify_api_request()
    data = request.get_json(silent=True) or {}
    friend_id = data.get('friendId')
    deleter = data.get('deleter')
    if not friend_id or not deleter:
        return jsonify({'message': 'friendId and deleter required'}), 400
    socketio.emit('friend_deleted_event', {'deleter': deleter}, room=f'user_{friend_id}')
    return jsonify({'status': 'ok'}), 200


@app.post('/relay/friend-rejected')
def relay_friend_rejected_http():
    _verify_api_request()
    data = request.get_json(silent=True) or {}
    requester_id = data.get('requesterId')
    rejector_data = data.get('rejector')
    if not requester_id or not rejector_data:
        return jsonify({'message': 'requesterId and rejector required'}), 400
    print(f'Emitting friend_request_rejected_event to user_{requester_id} from: {rejector_data.get("username", "unknown")}')
    socketio.emit('friend_request_rejected_event', {'rejector': rejector_data}, room=f'user_{requester_id}')
    return jsonify({'status': 'ok'}), 200


@app.post('/relay/friend-request-cancelled')
def relay_friend_request_cancelled_http():
    _verify_api_request()
    data = request.get_json(silent=True) or {}
    recipient_id = data.get('recipientId')
    canceller_data = data.get('canceller')
    if not recipient_id or not canceller_data:
        return jsonify({'message': 'recipientId and canceller required'}), 400
    print(f'Emitting friend_request_cancelled_event to user_{recipient_id} from: {canceller_data.get("username", "unknown")}')
    socketio.emit('friend_request_cancelled_event', {'canceller': canceller_data}, room=f'user_{recipient_id}')
    return jsonify({'status': 'ok'}), 200


@app.post('/relay/user-blocked')
def relay_user_blocked_http():
    _verify_api_request()
    data = request.get_json(silent=True) or {}
    blocked_user_id = data.get('blockedUserId')
    blocker_data = data.get('blocker')
    if not blocked_user_id or not blocker_data:
        return jsonify({'message': 'blockedUserId and blocker required'}), 400
    print(f'Emitting user_blocked_event to user_{blocked_user_id} by {blocker_data.get("username", "unknown")}')
    socketio.emit('user_blocked_event', {'blocker': blocker_data}, room=f'user_{blocked_user_id}')
    return jsonify({'status': 'ok'}), 200


@app.post('/relay/user-unblocked')
def relay_user_unblocked_http():
    _verify_api_request()
    data = request.get_json(silent=True) or {}
    unblocked_user_id = data.get('unblockedUserId')
    unblocker_data = data.get('unblocker')
    if not unblocked_user_id or not unblocker_data:
        return jsonify({'message': 'unblockedUserId and unblocker required'}), 400
    print(f'Emitting user_unblocked_event to user_{unblocked_user_id} by {unblocker_data.get("username", "unknown")}')
    socketio.emit('user_unblocked_event', {'unblocker': unblocker_data}, room=f'user_{unblocked_user_id}')
    return jsonify({'status': 'ok'}), 200


@app.post('/relay/message-status')
def relay_message_status_http():
    _verify_api_request()
    data = request.get_json(silent=True) or {}
    sender_id = data.get('senderId')
    status_data = data.get('status')
    if not sender_id or not status_data:
        return jsonify({'message': 'senderId and status required'}), 400
    print(f'Emitting message_status_update_event to user_{sender_id}: {status_data}')
    socketio.emit('message_status_update_event', status_data, room=f'user_{sender_id}')
    return jsonify({'status': 'ok'}), 200


@app.post('/relay/message-deleted')
def relay_message_deleted_http():
    _verify_api_request()
    data = request.get_json(silent=True) or {}
    user_id = data.get('userId')
    message_id = data.get('messageId')
    conversation_id = data.get('conversationId')
    if not user_id or not message_id or not conversation_id:
        return jsonify({'message': 'userId, messageId, and conversationId required'}), 400
    print(f'Emitting message_deleted_event to user_{user_id}: message {message_id}')
    socketio.emit('message_deleted_event', {
        'messageId': message_id,
        'conversationId': conversation_id
    }, room=f'user_{user_id}')
    return jsonify({'status': 'ok'}), 200


@app.post('/relay/message-edited')
def relay_message_edited_http():
    _verify_api_request()
    data = request.get_json(silent=True) or {}
    receiver_id = data.get('receiverId')
    edit_data = data.get('editData')
    if not receiver_id or not edit_data:
        return jsonify({'message': 'receiverId and editData required'}), 400
    print(f'Emitting message_edited_event to user_{receiver_id}: message {edit_data.get("messageId")}')
    socketio.emit('message_edited_event', edit_data, room=f'user_{receiver_id}')
    return jsonify({'status': 'ok'}), 200


@app.post('/relay/message-unsent')
def relay_message_unsent_http():
    _verify_api_request()
    data = request.get_json(silent=True) or {}
    receiver_id = data.get('receiverId')
    unsent_data = data.get('unsentData')
    if not receiver_id or not unsent_data:
        return jsonify({'message': 'receiverId and unsentData required'}), 400
    print(f'Emitting message_unsent_event to user_{receiver_id}: message {unsent_data.get("messageId")}')
    socketio.emit('message_unsent_event', unsent_data, room=f'user_{receiver_id}')
    return jsonify({'status': 'ok'}), 200


@app.post('/relay/message-saved')
def relay_message_saved_http():
    _verify_api_request()
    data = request.get_json(silent=True) or {}
    receiver_id = data.get('receiverId')
    message_id = data.get('messageId')
    conversation_id = data.get('conversationId')
    saved = data.get('saved')
    if not receiver_id or message_id is None or conversation_id is None or saved is None:
        return jsonify({'message': 'receiverId, messageId, conversationId, and saved required'}), 400
    print(f'Emitting message_saved_event to user_{receiver_id}: message {message_id} saved={saved}')
    socketio.emit('message_saved_event', {
        'messageId': message_id,
        'conversationId': conversation_id,
        'saved': saved
    }, room=f'user_{receiver_id}')
    return jsonify({'status': 'ok'}), 200


# ============================================================================
# GROUP CHAT RELAY ENDPOINTS
# ============================================================================

@app.post('/relay/group-created')
def relay_group_created_http():
    _verify_api_request()
    data = request.get_json(silent=True) or {}
    member_id = data.get('memberId')
    group_data = data.get('group')
    if not member_id or not group_data:
        return jsonify({'message': 'memberId and group required'}), 400
    print(f'Emitting group_created_event to user_{member_id}')
    socketio.emit('group_created_event', {'group': group_data}, room=f'user_{member_id}')
    return jsonify({'status': 'ok'}), 200


@app.post('/relay/group-message')
def relay_group_message_http():
    _verify_api_request()
    data = request.get_json(silent=True) or {}
    member_id = data.get('memberId')
    message_data = data.get('data')
    if not member_id or not message_data:
        return jsonify({'message': 'memberId and data required'}), 400
    print(f'Emitting group_message_received to user_{member_id}')
    socketio.emit('group_message_received', message_data, room=f'user_{member_id}')
    return jsonify({'status': 'ok'}), 200


@app.post('/relay/group-member-added')
def relay_group_member_added_http():
    _verify_api_request()
    data = request.get_json(silent=True) or {}
    member_id = data.get('memberId')
    member_data = data.get('data')
    if not member_id or not member_data:
        return jsonify({'message': 'memberId and data required'}), 400
    print(f'Emitting group_member_added_event to user_{member_id}')
    socketio.emit('group_member_added_event', member_data, room=f'user_{member_id}')
    return jsonify({'status': 'ok'}), 200


@app.post('/relay/group-member-removed')
def relay_group_member_removed_http():
    _verify_api_request()
    data = request.get_json(silent=True) or {}
    member_id = data.get('memberId')
    remove_data = data.get('data')
    if not member_id or not remove_data:
        return jsonify({'message': 'memberId and data required'}), 400
    print(f'Emitting group_member_removed_event to user_{member_id}')
    socketio.emit('group_member_removed_event', remove_data, room=f'user_{member_id}')
    return jsonify({'status': 'ok'}), 200


@app.post('/relay/group-deleted')
def relay_group_deleted_http():
    _verify_api_request()
    data = request.get_json(silent=True) or {}
    member_id = data.get('memberId')
    delete_data = data.get('data')
    if not member_id or not delete_data:
        return jsonify({'message': 'memberId and data required'}), 400
    print(f'Emitting group_deleted_event to user_{member_id}')
    socketio.emit('group_deleted_event', delete_data, room=f'user_{member_id}')
    return jsonify({'status': 'ok'}), 200


@app.post('/relay/group-message-edited')
def relay_group_message_edited_http():
    _verify_api_request()
    data = request.get_json(silent=True) or {}
    member_id = data.get('memberId')
    edit_data = data.get('editData')
    if not member_id or not edit_data:
        return jsonify({'message': 'memberId and editData required'}), 400
    print(f'Emitting group_message_edited_event to user_{member_id}')
    socketio.emit('group_message_edited_event', edit_data, room=f'user_{member_id}')
    return jsonify({'status': 'ok'}), 200


@app.post('/relay/group-message-unsent')
def relay_group_message_unsent_http():
    _verify_api_request()
    data = request.get_json(silent=True) or {}
    member_id = data.get('memberId')
    unsent_data = data.get('unsentData')
    if not member_id or not unsent_data:
        return jsonify({'message': 'memberId and unsentData required'}), 400
    print(f'Emitting group_message_unsent_event to user_{member_id}')
    socketio.emit('group_message_unsent_event', unsent_data, room=f'user_{member_id}')
    return jsonify({'status': 'ok'}), 200


@app.post('/relay/group-message-read')
def relay_group_message_read_http():
    _verify_api_request()
    data = request.get_json(silent=True) or {}
    sender_id = data.get('senderId')
    read_data = data.get('readData')
    if not sender_id or not read_data:
        return jsonify({'message': 'senderId and readData required'}), 400
    print(f'Emitting group_message_read_event to user_{sender_id}')
    socketio.emit('group_message_read_event', read_data, room=f'user_{sender_id}')
    return jsonify({'status': 'ok'}), 200


@app.post('/relay/group-key-rotated')
def relay_group_key_rotated_http():
    _verify_api_request()
    data = request.get_json(silent=True) or {}
    member_id = data.get('memberId')
    key_data = data.get('keyData')
    if not member_id or not key_data:
        return jsonify({'message': 'memberId and keyData required'}), 400
    print(f'Emitting group_key_rotated_event to user_{member_id}')
    socketio.emit('group_key_rotated_event', key_data, room=f'user_{member_id}')
    return jsonify({'status': 'ok'}), 200


@app.post('/relay/group-message-deleted')
def relay_group_message_deleted_http():
    _verify_api_request()
    data = request.get_json(silent=True) or {}
    member_id = data.get('memberId')
    delete_data = data.get('deleteData')
    if not member_id or not delete_data:
        return jsonify({'message': 'memberId and deleteData required'}), 400
    print(f'Emitting group_message_deleted_event to user_{member_id}')
    socketio.emit('group_message_deleted_event', delete_data, room=f'user_{member_id}')
    return jsonify({'status': 'ok'}), 200


@app.post('/relay/group-message-saved')
def relay_group_message_saved_http():
    _verify_api_request()
    data = request.get_json(silent=True) or {}
    member_id = data.get('memberId')
    save_data = data.get('saveData')
    if not member_id or not save_data:
        return jsonify({'message': 'memberId and saveData required'}), 400
    print(f'Emitting group_message_saved_event to user_{member_id}')
    socketio.emit('group_message_saved_event', save_data, room=f'user_{member_id}')
    return jsonify({'status': 'ok'}), 200


@app.post('/relay/group-updated')
def relay_group_updated_http():
    _verify_api_request()
    data = request.get_json(silent=True) or {}
    member_id = data.get('memberId')
    update_data = data.get('updateData')
    if not member_id or not update_data:
        return jsonify({'message': 'memberId and updateData required'}), 400
    print(f'Emitting group_updated_event to user_{member_id} for group {update_data.get("groupChatID")}')
    socketio.emit('group_updated_event', update_data, room=f'user_{member_id}')
    return jsonify({'status': 'ok'}), 200


if __name__ == '__main__':
    print('Starting TLS Relay Server on port 5001...')
    socketio.run(app, host='0.0.0.0', port=5001, debug=True)
