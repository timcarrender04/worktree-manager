'use client';

import { useState, useEffect, useRef } from 'react';

interface VoiceInputProps {
  onTranscript: (text: string) => void;
  disabled?: boolean;
}

// Type declaration for Web Speech API
declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
  }
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((this: SpeechRecognition, ev: Event) => any) | null;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null;
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => any) | null;
  onend: ((this: SpeechRecognition, ev: Event) => any) | null;
}

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

declare var SpeechRecognition: {
  prototype: SpeechRecognition;
  new (): SpeechRecognition;
};

export function VoiceInput({ onTranscript, disabled = false }: VoiceInputProps) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const manualStopRef = useRef(true);
  const restartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committedTranscriptRef = useRef('');
  const sessionTranscriptRef = useRef('');
  const isRecordingActiveRef = useRef(false);

  useEffect(() => {
    const scheduleRestart = (delay = 250) => {
      if (restartTimeoutRef.current) {
        clearTimeout(restartTimeoutRef.current);
      }
      restartTimeoutRef.current = setTimeout(() => {
        if (!isRecordingActiveRef.current || manualStopRef.current) {
          return;
        }
        if (recognitionRef.current) {
          try {
            sessionTranscriptRef.current = '';
            recognitionRef.current.start();
          } catch (err) {
            const domError = err as DOMException;
            if (domError && domError.name === 'InvalidStateError') {
              scheduleRestart(Math.min(delay * 3.5, 2000));
              return;
            }
            console.error('Failed to resume recognition:', err);
            manualStopRef.current = true;
            setError('Failed to resume voice recognition');
            isRecordingActiveRef.current = false;
          }
        }
      }, delay);
    };

    // Check if browser supports Speech Recognition
    if (typeof window === 'undefined') return;

    const SpeechRecognition = 
      (window as any).SpeechRecognition || 
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError('Speech recognition not supported in this browser');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setIsListening(true);
      setError(null);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += text;
        } else {
          interimTranscript += text;
        }
      }

      const finalText = finalTranscript.trim();
      if (finalText) {
        const separator = sessionTranscriptRef.current ? ' ' : '';
        sessionTranscriptRef.current = `${sessionTranscriptRef.current}${separator}${finalText}`.trim();

        const fullSeparator = committedTranscriptRef.current ? ' ' : '';
        const fullText = `${committedTranscriptRef.current}${fullSeparator}${sessionTranscriptRef.current}`.trim();
        onTranscript(fullText);
      }

      const interimText = interimTranscript.trim();
      const baseText = committedTranscriptRef.current;
      const currentSessionText = sessionTranscriptRef.current;

      let displayText = baseText;
      if (currentSessionText) {
        const sep1 = displayText ? ' ' : '';
        displayText = `${displayText}${sep1}${currentSessionText}`;
      }
      if (interimText) {
        const sep2 = displayText ? ' ' : '';
        displayText = `${displayText}${sep2}${interimText}`;
      }

      setTranscript(displayText);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('Speech recognition error:', event.error);
      if (sessionTranscriptRef.current) {
        const separator = committedTranscriptRef.current ? ' ' : '';
        committedTranscriptRef.current = `${committedTranscriptRef.current}${separator}${sessionTranscriptRef.current}`.trim();
        sessionTranscriptRef.current = '';
        setTranscript(committedTranscriptRef.current);
        onTranscript(committedTranscriptRef.current);
      }

      if (event.error === 'no-speech' || event.error === 'aborted' || event.error === 'network') {
        manualStopRef.current = false;
        setError(null);
        if (isRecordingActiveRef.current) {
          scheduleRestart();
        }
        return;
      } else if (event.error === 'audio-capture') {
        setError('Microphone not found. Please check your microphone.');
        manualStopRef.current = true;
        isRecordingActiveRef.current = false;
      } else if (event.error === 'not-allowed') {
        setError('Microphone permission denied. Please allow microphone access.');
        manualStopRef.current = true;
        isRecordingActiveRef.current = false;
      } else {
        setError(`Speech recognition error: ${event.error}`);
        manualStopRef.current = true;
        isRecordingActiveRef.current = false;
      }

      if (manualStopRef.current && restartTimeoutRef.current) {
        clearTimeout(restartTimeoutRef.current);
        restartTimeoutRef.current = null;
      }

      setIsListening(false);
    };

    recognition.onend = () => {
      if (sessionTranscriptRef.current) {
        const separator = committedTranscriptRef.current ? ' ' : '';
        committedTranscriptRef.current = `${committedTranscriptRef.current}${separator}${sessionTranscriptRef.current}`.trim();
        sessionTranscriptRef.current = '';
        setTranscript(committedTranscriptRef.current);
        onTranscript(committedTranscriptRef.current);
      }

      setIsListening(false);
      if (!manualStopRef.current && isRecordingActiveRef.current) {
        scheduleRestart();
      }
    };

    recognitionRef.current = recognition;

    return () => {
      manualStopRef.current = true;
      isRecordingActiveRef.current = false;
      if (restartTimeoutRef.current) {
        clearTimeout(restartTimeoutRef.current);
      }
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, [onTranscript]);

  const startListening = () => {
    if (recognitionRef.current && !isListening) {
      setError(null);
      setTranscript(committedTranscriptRef.current);
      sessionTranscriptRef.current = '';
      manualStopRef.current = false;
      isRecordingActiveRef.current = true;
      try {
        recognitionRef.current.start();
      } catch (err) {
        console.error('Failed to start recognition:', err);
        setError('Failed to start voice recognition');
        manualStopRef.current = true;
        isRecordingActiveRef.current = false;
      }
    }
  };

  const stopListening = () => {
    if (recognitionRef.current && isListening) {
      manualStopRef.current = true;
      isRecordingActiveRef.current = false;

      if (sessionTranscriptRef.current) {
        const separator = committedTranscriptRef.current ? ' ' : '';
        committedTranscriptRef.current = `${committedTranscriptRef.current}${separator}${sessionTranscriptRef.current}`.trim();
        sessionTranscriptRef.current = '';
        setTranscript(committedTranscriptRef.current);
        onTranscript(committedTranscriptRef.current);
      }

      recognitionRef.current.stop();
    }
  };

  const clearTranscript = () => {
    committedTranscriptRef.current = '';
    sessionTranscriptRef.current = '';
    setTranscript('');
    setError(null);
    onTranscript('');
    if (recognitionRef.current && isListening) {
      manualStopRef.current = true;
      isRecordingActiveRef.current = false;
      recognitionRef.current.stop();
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setTranscript(value);
    committedTranscriptRef.current = value;
    sessionTranscriptRef.current = '';
    onTranscript(value.trim());
  };

  const fatalError = error ? /not supported|permission denied|microphone not found/i.test(error) : false;

  return (
    <div className="space-y-2">
      {/* Text Input Area */}
      <textarea
        value={transcript}
        onChange={handleTextChange}
        placeholder="Type your task description here, or use voice input below..."
        disabled={disabled || isListening}
        className="w-full px-4 py-3 border border-[var(--white-100)] rounded-lg bg-[var(--white)] text-[var(--foreground)] focus:ring-2 focus:ring-[var(--accent)] focus:border-[var(--accent)] transition-colors resize-none min-h-[120px] disabled:bg-[var(--white-100)] disabled:text-[var(--foreground-muted)] disabled:cursor-not-allowed"
        rows={4}
      />
      
      {/* Voice Input Controls */}
      <div className="flex items-center gap-2">
        <div className="text-xs text-[var(--foreground-muted)] flex-1">
          Or use voice input:
        </div>
        <button
          type="button"
          onClick={isListening ? stopListening : startListening}
          disabled={disabled || fatalError}
          className={`px-4 py-2 rounded-md font-medium transition-colors text-sm ${
            isListening
              ? 'bg-red-600 text-white hover:bg-red-700'
              : 'bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed'
          }`}
        >
          {isListening ? (
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 bg-white rounded-full animate-pulse"></span>
              Stop Recording
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
              Start Recording
            </span>
          )}
        </button>
        {transcript && (
          <button
            type="button"
            onClick={clearTranscript}
            className="px-3 py-2 text-sm text-[var(--foreground-muted)] hover:text-[var(--foreground)] bg-[var(--white-100)] rounded-lg hover:bg-[var(--white-100)]/80 transition-colors"
          >
            Clear
          </button>
        )}
      </div>
      
      {error && (
        <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg border border-red-200">
          {error}
        </div>
      )}
      
      {isListening && !error && (
        <div className="text-sm text-[var(--accent)] flex items-center gap-2">
          <span className="w-2 h-2 bg-[var(--accent)] rounded-full animate-pulse"></span>
          Listening... Speak now or click "Stop Recording" when done.
        </div>
      )}
    </div>
  );
}
