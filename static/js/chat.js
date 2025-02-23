/*
 * Simplified chat.js for Talking Avatar Chat
 */

// Global variables
var speechRecognizer;
var avatarSynthesizer;
var peerConnection;
var messages = [];
var messageInitiated = false;
var isSpeaking = false;
var spokenTextQueue = [];
var sessionActive = false;
var lastSpeakTime;
var token = ""; // Global token for speech recognition

// Initialize system prompt messages
function initMessages() {
    messages = [];
    let systemMessage = {
       role: 'system',
       content: "You are an AI assistant that helps answer questions using a talking avatar."
    };
    messages.push(systemMessage);
}

// Connect to avatar service by retrieving tokens from your backend
function connectAvatar() {
    fetch("/get-speech-region")
        .then(response => response.json())
        .then(regionData => {
            const speechRegion = regionData.speech_region;
            // Get the speech token
            fetch("/get-speech-token")
                .then(response => response.json())
                .then(tokenData => {
                    token = tokenData.token; // store globally for recognition
                    // Create speech synthesis configuration
                    const speechSynthesisConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(token, speechRegion);
                    speechSynthesisConfig.speechSynthesisVoiceName = "en-US-AvaMultilingualNeural";
                    // Set default avatar configuration (hardcoded from env)
                    const talkingAvatarCharacter = "Lisa";
                    const talkingAvatarStyle = "casual-sitting";
                    const avatarConfig = new SpeechSDK.AvatarConfig(talkingAvatarCharacter, talkingAvatarStyle);
                    avatarConfig.customized = false;
                    avatarSynthesizer = new SpeechSDK.AvatarSynthesizer(speechSynthesisConfig, avatarConfig);
                    avatarSynthesizer.avatarEventReceived = function(s, e) {
                        console.log("Avatar event: " + e.description);
                    };
                    // Get ICE token from backend for WebRTC
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
        .catch(err => console.error("Error fetching speech region:", err));

    if (!messageInitiated) {
        initMessages();
        messageInitiated = true;
    }

    // Disable the start session button once clicked
    document.getElementById('startSession').disabled = true;
}

// Set up WebRTC connection so the avatar video/audio shows in #remoteVideo
function setupWebRTC(iceServerUrl, iceServerUsername, iceServerCredential) {
    peerConnection = new RTCPeerConnection({
         iceServers: [{
             urls: [iceServerUrl],
             username: iceServerUsername,
             credential: iceServerCredential
         }]
    });
    
    peerConnection.ontrack = function(event) {
         if (event.track.kind === 'audio') {
             let audioElement = document.createElement('audio');
             audioElement.id = 'audioPlayer';
             audioElement.srcObject = event.streams[0];
             audioElement.autoplay = true;
             console.log("WebRTC audio connected.");
             const container = document.getElementById('remoteVideo');
             container.querySelectorAll('audio').forEach(el => el.remove());
             container.appendChild(audioElement);
         }
         if (event.track.kind === 'video') {
            let videoElement = document.createElement('video');
            videoElement.id = 'videoPlayer';
            videoElement.srcObject = event.streams[0];
            videoElement.autoplay = true;
            videoElement.playsInline = true;
            videoElement.muted = true; // Mute video to allow autoplay without user gesture
            videoElement.onplaying = () => {
               const container = document.getElementById('remoteVideo');
               container.querySelectorAll('video').forEach(el => el.remove());
               container.appendChild(videoElement);
               console.log("WebRTC video connected.");
               // Enable microphone (startRecording button)
               document.getElementById('startRecording').disabled = false;
               sessionActive = true;
            };
            videoElement.play().catch(e => console.error("Error playing video: ", e));
        }        
    };
    
    // Offer to receive one audio and one video track
    peerConnection.addTransceiver('video', { direction: 'sendrecv' });
    peerConnection.addTransceiver('audio', { direction: 'sendrecv' });
    
    // Start the avatar (which establishes the connection)
    avatarSynthesizer.startAvatarAsync(peerConnection)
    .then((r) => {
        if (r.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
            console.log("Avatar started. Result ID: " + r.resultId);
        } else {
            console.log("Avatar failed to start. Reason: " + r.errorDetails || r.reason);
            console.log("Result ID: " + r.resultId);
            document.getElementById('startSession').disabled = false;
        }
    })
    .catch((error) => {
        console.error("Avatar start error: ", error);
        if (error instanceof SpeechSDK.SpeechSynthesisResult) {
            console.error("Error details: " + error.errorDetails);
        } else if (error instanceof Error) {
            console.error("Error message: " + error.message);
        }
        document.getElementById('startSession').disabled = false;
    });
    }

// Start recording user speech (called when the microphone button is clicked)
window.startRecording = () => {
    if (!token) {
        console.error("Speech token not available.");
        return;
    }
    if (speechRecognizer) {
        window.stopRecording();
        return;
    }    
    // For recognition, use the same region you got earlier.
    // (You could also fetch /get-speech-region again if needed.)
    fetch("/get-speech-region")
        .then(response => response.json())
        .then(regionData => {
            const speechRegion = regionData.speech_region;
            const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(token, speechRegion);
            speechConfig.SpeechServiceConnection_LanguageIdMode = "Continuous";
            const supported_languages = ["en-US", "de-DE", "zh-CN", "nl-NL"];
            const autoDetectSourceLanguageConfig = SpeechSDK.AutoDetectSourceLanguageConfig.fromLanguages(supported_languages);

            // Change the microphone button icon to indicate "stop"
            document.getElementById('buttonIcon').className = "fas fa-stop";
            document.getElementById('startRecording').disabled = true;

            // Create the recognizer using the default microphone input
            speechRecognizer = SpeechSDK.SpeechRecognizer.FromConfig(speechConfig, autoDetectSourceLanguageConfig, SpeechSDK.AudioConfig.fromDefaultMicrophoneInput());

            speechRecognizer.recognized = function(s, e) {
                if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
                    let userQuery = e.result.text.trim();
                    if (userQuery === "") return;
                    console.log("Recognized:", userQuery);
                    // Stop recognition if not continuous
                    window.stopRecording();
                    // Call backend /speak to get the assistant's response
                    handleUserQuery(userQuery, "", "");
                }
            };

            speechRecognizer.startContinuousRecognitionAsync(() => {
                document.getElementById('startRecording').innerHTML = '<i id="buttonIcon" class="fas fa-stop"></i>';
                document.getElementById('startRecording').disabled = false;
                console.log("Recording started.");
            }, (err) => {
                console.error("Failed to start recognition:", err);
                document.getElementById('startRecording').disabled = false;
            });
        })
        .catch(err => console.error("Error fetching speech region:", err));
};

// Stop recording speech
window.stopRecording = () => {
    if (speechRecognizer) {
         speechRecognizer.stopContinuousRecognitionAsync(() => {
             speechRecognizer.close();
             speechRecognizer = undefined;
             document.getElementById('buttonIcon').className = "fas fa-microphone";
             document.getElementById('startRecording').disabled = false;
             console.log("Recording stopped.");
         }, (err) => {
             console.error("Error stopping recognition:", err);
         });
    }
};

// Handle user query by sending it to backend /speak endpoint
function handleUserQuery(userQuery, userQueryHTML, imgUrlPath) {
    let contentMessage = userQuery;
    if (imgUrlPath.trim()) {
         contentMessage = [
             { type: "text", text: userQuery },
             { type: "image_url", image_url: { url: imgUrlPath } }
         ];
    }
    let chatMessage = { role: 'user', content: contentMessage };
    messages.push(chatMessage);
    
    let chatHistoryTextArea = document.getElementById('chatHistory');
    chatHistoryTextArea.innerHTML += "<br/><br/>User: " + userQuery + "<br/>";
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
         chatHistoryTextArea.innerHTML += "Assistant: ";
         const reader = response.body.getReader();
         function read() {
             return reader.read().then(({ value, done }) => {
                 if (done) return;
                 let chunk = new TextDecoder().decode(value, { stream: true });
                 assistantReply += chunk;
                 displaySentence += chunk;
                 spokenSentence += chunk;
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

// Speak text using avatarSynthesizer TTS
function speak(text, endingSilenceMs = 0) {
    if (isSpeaking) {
         spokenTextQueue.push(text);
         return;
    }
    speakNext(text, endingSilenceMs);
}

function speakNext(text, endingSilenceMs = 0) {
    const ttsVoice = "en-US-AvaMultilingualNeural";
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

// Session control functions
window.startSession = () => { connectAvatar(); };
window.stopSession = () => {
    document.getElementById('startSession').disabled = false;
    document.getElementById('startRecording').disabled = true;
    if (speechRecognizer) {
         speechRecognizer.stopContinuousRecognitionAsync(() => {
             speechRecognizer.close();
             speechRecognizer = undefined;
         });
    }
    if (avatarSynthesizer) {
         avatarSynthesizer.close();
    }
    sessionActive = false;
};
window.clearChatHistory = () => {
    document.getElementById('chatHistory').innerHTML = '';
    initMessages();
};
