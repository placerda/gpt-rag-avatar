// chat.js
// (Copy over the chat.js code from the sample avatar chat project)
// The file includes code to set up speech recognition, connect to the avatar service,
// invoke Azure OpenAI for chat completions, and handle UI updates for chat history.
var speechRecognizer;
var avatarSynthesizer;
var peerConnection;
var messages = [];
// ... (rest of the code as provided in the sample)

function connectAvatar() {
  // (Implementation similar to the sample chat.js file)
  // This sets up the avatarSynthesizer and speechRecognizer.
}

function setupWebRTC(iceServerUrl, iceServerUsername, iceServerCredential) {
  // (Implementation similar to the sample chat.js file)
}

function disconnectAvatar() {
  // (Disconnects avatarSynthesizer and stops speechRecognizer)
}

function initMessages() {
  // (Initializes chat messages, including a system message with the prompt)
}

function handleUserQuery(userQuery, userQueryHTML, imgUrlPath) {
  // (Handles sending the user query to Azure OpenAI and streaming the response)
}

window.startSession = () => {
  // (Calls connectAvatar and sets up the session)
};

window.stopSession = () => {
  // (Stops the session and cleans up)
};

window.microphone = () => {
  // (Starts or stops speech recognition)
};

window.clearChatHistory = () => {
  // (Clears the chat history)
};

window.updateTypeMessageBox = () => {
  // (Shows or hides the text message box)
};

window.stopSpeaking = () => {
  // (Stops the avatar speaking)
};

// ... (Additional functions from the sample chat.js)
