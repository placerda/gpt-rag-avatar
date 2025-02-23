// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license.

// Global objects
var speechRecognizer;
var avatarSynthesizer;
var peerConnection;
var messages = [];
var messageInitiated = false;
var sentenceLevelPunctuations = [ '.', '?', '!', ':', ';', '。', '？', '！', '：', '；' ];
var isSpeaking = false;
var spokenTextQueue = [];
var sessionActive = false;
var lastSpeakTime;
var imgUrl = "";

// Initialize messages with system prompt from configuration (if needed)
function initMessages() {
    messages = [];
    // You can set your default system prompt here.
    let systemMessage = {
        role: 'system',
        content: "You are an AI assistant that helps answer questions using a talking avatar."
    };
    messages.push(systemMessage);
}

// Simplified connectAvatar: get tokens from backend instead of user inputs.
function connectAvatar() {
    fetch("/get-speech-region")
    .then(response => response.json())
    .then(speech_region_data => {
        const speechRegion = speech_region_data.speech_region;
        // Get the speech token from the backend
        fetch("/get-speech-token")
            .then(response => response.json())
            .then(data => {
                const speechToken = data.token;
                // Create speech synthesis configuration using the token and region
                const speechSynthesisConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(speechToken, speechRegion);
                // Optionally set your default voice here
                speechSynthesisConfig.speechSynthesisVoiceName = "en-US-AvaMultilingualNeural";

                // Set up a default avatar configuration (hardcoded values from your env)
                const talkingAvatarCharacter = "Lisa";       // default character
                const talkingAvatarStyle = "casual-sitting";   // default style
                const avatarConfig = new SpeechSDK.AvatarConfig(talkingAvatarCharacter, talkingAvatarStyle);
                avatarConfig.customized = false;
                avatarSynthesizer = new SpeechSDK.AvatarSynthesizer(speechSynthesisConfig, avatarConfig);
                avatarSynthesizer.avatarEventReceived = function (s, e) {
                    console.log("Avatar event: " + e.description);
                };

                // Once speech is configured, get ICE token for WebRTC
                fetch("/get-ice-server-token")
                    .then(response => response.json())
                    .then(iceData => {
                        const iceServerUrl = iceData.Urls[0];
                        const iceServerUsername = iceData.Username;
                        const iceServerCredential = iceData.Password;
                        setupWebRTC(iceServerUrl, iceServerUsername, iceServerCredential);
                    })
                    .catch(err => console.error("Error fetching ICE token:", err));
            })
            .catch(err => console.error("Error fetching speech token:", err));

    })
    .catch(err => console.error("Error getting speech region:", err));

    // Initialize messages only once.
    if (!messageInitiated) {
        initMessages();
        messageInitiated = true;
    }

    // Hide configuration UI (if any) and disable the Start button.
    document.getElementById('startSession').disabled = true;
    document.getElementById('configuration') && (document.getElementById('configuration').hidden = true);
}

// Disconnect avatar and speech recognizer.
function disconnectAvatar() {
    if (avatarSynthesizer !== undefined) {
        avatarSynthesizer.close();
    }
    if (speechRecognizer !== undefined) {
        speechRecognizer.stopContinuousRecognitionAsync();
        speechRecognizer.close();
    }
    sessionActive = false;
}

// Setup WebRTC using ICE info from the backend.
function setupWebRTC(iceServerUrl, iceServerUsername, iceServerCredential) {
    peerConnection = new RTCPeerConnection({
        iceServers: [{
            urls: [iceServerUrl],
            username: iceServerUsername,
            credential: iceServerCredential
        }]
    });

    peerConnection.ontrack = function (event) {
        if (event.track.kind === 'audio') {
            let audioElement = document.createElement('audio');
            audioElement.id = 'audioPlayer';
            audioElement.srcObject = event.streams[0];
            audioElement.autoplay = true;
            console.log(`WebRTC audio channel connected.`);
            // Remove existing audio element (if any) and append the new one.
            const container = document.getElementById('remoteVideo');
            Array.from(container.childNodes).forEach(child => {
                if (child.localName === 'audio') container.removeChild(child);
            });
            container.appendChild(audioElement);
        }

        if (event.track.kind === 'video') {
            let videoElement = document.createElement('video');
            videoElement.id = 'videoPlayer';
            videoElement.srcObject = event.streams[0];
            videoElement.autoplay = true;
            videoElement.playsInline = true;
            videoElement.onplaying = () => {
                const container = document.getElementById('remoteVideo');
                Array.from(container.childNodes).forEach(child => {
                    if (child.localName === 'video') container.removeChild(child);
                });
                container.appendChild(videoElement);
                console.log("WebRTC video channel connected.");
                document.getElementById('microphone').disabled = false;
                document.getElementById('stopSession').disabled = false;
                container.style.width = '960px';
                document.getElementById('chatHistory').hidden = false;
                setTimeout(() => { sessionActive = true; }, 5000);
            };
        }
    };

    // Offer to receive one audio and one video track.
    peerConnection.addTransceiver('video', { direction: 'sendrecv' });
    peerConnection.addTransceiver('audio', { direction: 'sendrecv' });

    // Start the avatar (which also establishes the WebRTC connection).
    avatarSynthesizer.startAvatarAsync(peerConnection).then((r) => {
        if (r.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
            console.log("Avatar started. Result ID: " + r.resultId);
        } else {
            console.log("Unable to start avatar. Result ID: " + r.resultId);
            document.getElementById('startSession').disabled = false;
            document.getElementById('configuration') && (document.getElementById('configuration').hidden = false);
        }
    }).catch((error) => {
        console.log("Avatar failed to start. Error: " + error);
        document.getElementById('startSession').disabled = false;
        document.getElementById('configuration') && (document.getElementById('configuration').hidden = false);
    });
}

// Speak text using TTS via the avatar synthesizer.
function speak(text, endingSilenceMs = 0) {
    if (isSpeaking) {
        spokenTextQueue.push(text);
        return;
    }
    speakNext(text, endingSilenceMs);
}

function speakNext(text, endingSilenceMs = 0) {
    // Use fixed voice settings (from your backend configuration)
    const ttsVoice = "en-US-AvaMultilingualNeural";
    // If you have a speaker profile from .env, you can hardcode it here.
    const personalVoiceSpeakerProfileID = "";
    let ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='en-US'><voice name='${ttsVoice}'><mstts:ttsembedding${personalVoiceSpeakerProfileID ? " speakerProfileId='" + personalVoiceSpeakerProfileID + "'" : ""}><mstts:leadingsilence-exact value='0'/>${text}</mstts:ttsembedding></voice></speak>`;
    if (endingSilenceMs > 0) {
        ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='en-US'><voice name='${ttsVoice}'><mstts:ttsembedding${personalVoiceSpeakerProfileID ? " speakerProfileId='" + personalVoiceSpeakerProfileID + "'" : ""}><mstts:leadingsilence-exact value='0'/>${text}<break time='${endingSilenceMs}ms' /></mstts:ttsembedding></voice></speak>`;
    }
    lastSpeakTime = new Date();
    isSpeaking = true;
    avatarSynthesizer.speakSsmlAsync(ssml).then((result) => {
        if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
            console.log(`Spoken: [${text}]. Result ID: ${result.resultId}`);
            lastSpeakTime = new Date();
        } else {
            console.log(`Error speaking text. Result ID: ${result.resultId}`);
        }
        if (spokenTextQueue.length > 0) {
            speakNext(spokenTextQueue.shift());
        } else {
            isSpeaking = false;
        }
    }).catch((error) => {
        console.log(`Error speaking SSML: [${error}]`);
        if (spokenTextQueue.length > 0) {
            speakNext(spokenTextQueue.shift());
        } else {
            isSpeaking = false;
        }
    });
}

function stopSpeaking() {
    spokenTextQueue = [];
    avatarSynthesizer.stopSpeakingAsync().then(() => {
        isSpeaking = false;
        console.log("Stop speaking request sent.");
    }).catch((error) => {
        console.log("Error stopping speaking: " + error);
    });
}

// Simplified handleUserQuery: send user query to backend /speak endpoint.
function handleUserQuery(userQuery, userQueryHTML, imgUrlPath) {
    let contentMessage = userQuery;
    if (imgUrlPath.trim()) {
        contentMessage = [
            { "type": "text", "text": userQuery },
            { "type": "image_url", "image_url": { "url": imgUrlPath } }
        ];
    }
    let chatMessage = { role: 'user', content: contentMessage };
    messages.push(chatMessage);

    let chatHistoryTextArea = document.getElementById('chatHistory');
    chatHistoryTextArea.innerHTML += "<br/><br/>User: " + (imgUrlPath.trim() ? userQueryHTML : userQuery) + "<br/>";
    chatHistoryTextArea.scrollTop = chatHistoryTextArea.scrollHeight;

    if (isSpeaking) { stopSpeaking(); }

    let payload = JSON.stringify({
        spokenText: userQuery,
        conversation_id: ""
    });

    let assistantReply = "";
    let spokenSentence = "";
    let displaySentence = "";

    fetch("/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`Chat API response status: ${response.status} ${response.statusText}`);
        }
        chatHistoryTextArea.innerHTML += 'Assistant: ';
        const reader = response.body.getReader();

        function read() {
            return reader.read().then(({ value, done }) => {
                if (done) { return; }
                let chunk = new TextDecoder().decode(value, { stream: true });
                assistantReply += chunk;
                displaySentence += chunk;
                spokenSentence += chunk;

                // When newline encountered, trigger speaking.
                if (chunk.trim() === "" || chunk.trim() === "\n") {
                    speak(spokenSentence.trim());
                    spokenSentence = "";
                }
                chatHistoryTextArea.innerHTML += displaySentence;
                chatHistoryTextArea.scrollTop = chatHistoryTextArea.scrollHeight;
                displaySentence = "";
                return read();
            });
        }
        return read();
    })
    .then(() => {
        if (spokenSentence !== "") {
            speak(spokenSentence.trim());
            spokenSentence = "";
        }
        let assistantMessage = { role: 'assistant', content: assistantReply };
        messages.push(assistantMessage);
    })
    .catch(error => {
        console.error("Error in handleUserQuery:", error);
    });
}

// Minimal microphone handling: start recognition and send recognized speech.
window.microphone = () => {
    document.getElementById('audioPlayer') && document.getElementById('audioPlayer').play();
    document.getElementById('microphone').disabled = true;
    speechRecognizer.recognized = (s, e) => {
        if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
            let userQuery = e.result.text.trim();
            if (userQuery !== "") {
                handleUserQuery(userQuery, "", "");
            }
        }
    };
    speechRecognizer.startContinuousRecognitionAsync(() => {
        document.getElementById('microphone').innerHTML = 'Stop Microphone';
        document.getElementById('microphone').disabled = false;
    }, (err) => {
        console.log("Failed to start recognition:", err);
        document.getElementById('microphone').disabled = false;
    });
};

// Basic session control functions.
window.startSession = () => { connectAvatar(); };
window.stopSession = () => {
    document.getElementById('startSession').disabled = false;
    document.getElementById('microphone').disabled = true;
    document.getElementById('stopSession').disabled = true;
    disconnectAvatar();
};
window.clearChatHistory = () => {
    document.getElementById('chatHistory').innerHTML = '';
    initMessages();
};
