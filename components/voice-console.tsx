"use client"
import { useEffect, useRef, useState } from "react"
import { 
  Mic, RotateCcw, Languages, MessageSquare, Play, Pause, 
  Save, Square, Loader, Volume2, Phone, FileText 
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { IVRDemo } from "@/components/ivr-demo"
import { AIResponseExplainer } from "@/components/ai-response-explainer"

// --- CONSTANTS & DATA ---

const LANGUAGES = [
  { code: 'auto', name: 'Auto Detect', native: '🌐 Auto' },
  { code: 'en', name: 'English', native: 'English' },
  { code: 'hi', name: 'Hindi', native: 'हिंदी' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்' },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം' },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు' },
]

const scenarioResponses: Record<string, string[]> = {
  "power outage": [
    "Power outage reported in your area. Technician has been dispatched and will arrive within 24 hours. For immediate assistance, please contact the emergency helpline at 1912.",
    "We've registered your power outage report. Estimated restoration time is 6-8 hours.",
  ],
  "water tank": [
    "Water tank level critical. Refill scheduled for tomorrow morning between 6-8 AM. You'll receive an SMS confirmation shortly.",
  ]
}

const aiExplanationData: Record<string, any> = {
  "power outage": {
    input: "Power outage in our area",
    agent: "Utility Management Agent",
    ruleEngine: "Emergency Response Protocol v2.1 - Priority 1",
    confidence: 95,
    decision: "Dispatch technician within 24 hours, send SMS confirmation",
    humanVerification: "Auto-verified by system."
  },
  "water tank": {
    input: "Water tank is almost empty",
    agent: "Water Resource Management Agent",
    ruleEngine: "Water Distribution Algorithm v3.0 - Critical Level",
    confidence: 92,
    decision: "Schedule emergency refill",
    humanVerification: "Auto-verified."
  }
}

export function VoiceConsole() {
  // --- STATE ---
  const [transcript, setTranscript] = useState("")
  const [reply, setReply] = useState("")
  const [isRecording, setIsRecording] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // Settings
  const [selectedLanguage, setSelectedLanguage] = useState('auto')
  const [isLargeText, setIsLargeText] = useState(false)
  const [isIVRMode, setIsIVRMode] = useState(false)
  
  // Metadata
  const [detectedLanguage, setDetectedLanguage] = useState<string>('')
  const [transcriptionDuration, setTranscriptionDuration] = useState<number>(0)
  const [showExplanation, setShowExplanation] = useState(false)
  const [currentExplanation, setCurrentExplanation] = useState<any>(null)

  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)

  // LOGIC (Unified) ---
  useEffect(() => {
    if (!reply) return
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return
    
    try {
      const u = new SpeechSynthesisUtterance(reply)
      utteranceRef.current = u
      const voices = window.speechSynthesis.getVoices()
      
      // Smart voice selection
      const isMalayalam = /[\u0D00-\u0D7F]/.test(reply)
      const isHindi = /[\u0900-\u097F]/.test(reply)
      
      let pref
      if (isMalayalam) pref = voices.find((v) => v.lang?.toLowerCase().includes('ml'))
      else if (isHindi) pref = voices.find((v) => v.lang?.toLowerCase().includes('hi'))
      
      if (!pref) {
        pref = voices.find((v) => v.lang?.includes("en-IN")) || voices.find((v) => v.lang?.startsWith("en"))
      }
      
      if (pref) u.voice = pref
      u.onend = () => setIsPlaying(false)
      u.onerror = () => setIsPlaying(false)
      
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(u)
      setIsPlaying(true)
    } catch (error) {
      console.error("TTS Error:", error)
    }
  }, [reply])

  // --- RECORDING LOGIC
  const startRecording = async () => {
    try {
      setError(null)
      setTranscript("")
      setReply("")
      setShowExplanation(false)
      setDetectedLanguage("")
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true } 
      })
      
      streamRef.current = stream
      // Prefer webm/opus, fallback to others
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
        ? 'audio/webm;codecs=opus' 
        : 'audio/webm';

      const mediaRecorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }
      
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType })
        await sendToWhisper(audioBlob)
        
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop())
        }
      }
      
      mediaRecorder.start()
      setIsRecording(true)
      
    } catch (err: any) {
      console.error('Recording Error:', err)
      setError(`Microphone access denied: ${err.message}`)
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      setIsRecording(false)
    }
  }

  // --- API LOGIC ---
  const sendToWhisper = async (audioBlob: Blob) => {
    try {
      setIsLoading(true)
      
      const formData = new FormData()
      formData.append('file', audioBlob, 'recording.webm') 
      if (selectedLanguage && selectedLanguage !== 'auto') {
        formData.append('language', selectedLanguage)
      }

      
      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      })
      
      if (!response.ok) throw new Error('Transcription failed')
      
      const data = await response.json()
      
      setTranscript(data.text)
      setTranscriptionDuration(audioBlob.size / 10000) // Rough estimate or use actual duration if API returns it
      
      // Pass the transcribed text to the business logic processor
      await processBusinessLogic(data.text)
      
    } catch (err: any) {
      setError(`Processing error: ${err.message}`)
    } finally {
      setIsLoading(false)
    }
  }

  // --- BUSINESS LOGIC ---
  const processBusinessLogic = async (text: string) => {
    if (!text.trim()) return

    const lowerText = text.toLowerCase()
    
    // 1. Check Local Scenarios
    const matchedScenario = Object.keys(scenarioResponses).find(scenario => 
      lowerText.includes(scenario)
    )

    if (matchedScenario) {
      setReply(scenarioResponses[matchedScenario][0])
      setCurrentExplanation(aiExplanationData[matchedScenario])
      setShowExplanation(true)
      return
    }

    // Fallback to AI (Mistral/OpenAI)
    
    try {
      const response = await fetch("/api/mistral", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text }),
      })
      const data = await response.json()
      setReply(data.response || "I processed that request.")
    } catch (e) {
      setReply("I heard you, but my AI brain is currently offline.")
    }
    
    
    setReply("I understand your query. Connecting you to an agent...") // Default fallback
  }

  // --- UI HELPERS ---
  const handleReset = () => {
    setTranscript("")
    setReply("")
    setError(null)
    setShowExplanation(false)
    setIsIVRMode(false)
    window.speechSynthesis.cancel()
    setIsPlaying(false)
  }

  return (
    <div className={`w-full max-w-4xl mx-auto p-4 space-y-6 ${isLargeText ? 'text-lg' : 'text-base'}`}>
      
      {/* HEADER & SETTINGS */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-6">
        <div>
           <h2 className="text-3xl font-bold">Voice Console</h2>
           <p className="text-muted-foreground">Whisper-1 Powered Assistant</p>
        </div>
        
        <div className="flex items-center gap-2">
           <Languages className="w-4 h-4 text-muted-foreground" />
           <Select value={selectedLanguage} onValueChange={setSelectedLanguage}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((lang) => (
                <SelectItem key={lang.code} value={lang.code}>{lang.native}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* MAIN RECORDING INTERFACE */}
      <Card className="border-t-4 border-t-blue-500 shadow-md">
        <CardContent className="pt-8 flex flex-col items-center gap-6">
           <Button
            size="lg"
            className={`w-32 h-32 rounded-full transition-all duration-300 shadow-lg ${
              isRecording 
                ? 'bg-red-500 hover:bg-red-600 animate-pulse scale-110 shadow-red-200' 
                : 'bg-blue-600 hover:bg-blue-700 shadow-blue-200'
            }`}
            onMouseDown={startRecording}
            onMouseUp={stopRecording}
            onTouchStart={startRecording}
            onTouchEnd={stopRecording}
            disabled={isLoading}
          >
            {isLoading ? <Loader className="w-12 h-12 animate-spin" /> : 
             isRecording ? <Square className="w-12 h-12" /> : 
             <Mic className="w-12 h-12" />}
          </Button>
          
          <div className="text-center space-y-1">
            <p className="font-medium text-lg">
              {isRecording ? 'Listening... Release to process' : 
               isLoading ? 'Analyzing Audio...' : 'Hold to Speak'}
            </p>
            {transcriptionDuration > 0 && !isRecording && (
              <Badge variant="secondary" className="mt-2">
                Processed in {transcriptionDuration.toFixed(2)}s
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ERROR DISPLAY */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 flex items-center gap-2">
           <span>⚠️</span> {error}
        </div>
      )}

      {/* RESULTS GRID */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* TRANSCRIPT */}
        <Card className={`${transcript ? 'opacity-100' : 'opacity-60'}`}>
            <CardHeader className="pb-2">
                <CardTitle className="text-sm uppercase text-muted-foreground flex items-center gap-2">
                    <MessageSquare className="w-4 h-4" /> You Said
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="min-h-[80px] p-3 bg-secondary/50 rounded-md">
                    {transcript || "..."}
                </div>
            </CardContent>
        </Card>

        {/* AI REPLY */}
        <Card className={`${reply ? 'border-green-200 bg-green-50/30' : 'opacity-60'}`}>
            <CardHeader className="pb-2">
                <CardTitle className="text-sm uppercase text-muted-foreground flex items-center gap-2">
                    <Volume2 className="w-4 h-4" /> Response
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="min-h-[80px] p-3 bg-background rounded-md mb-2">
                    {reply || "..."}
                </div>
                {reply && (
                    <Button variant="outline" size="sm" onClick={() => setIsPlaying(!isPlaying)}>
                        {isPlaying ? <Pause className="w-3 h-3 mr-2"/> : <Play className="w-3 h-3 mr-2"/>}
                        {isPlaying ? "Pause" : "Read Aloud"}
                    </Button>
                )}
            </CardContent>
        </Card>
      </div>

      {/* ADVANCED CONTROLS (Merged from Code 1) */}
      <div className="flex flex-wrap gap-2 justify-center pt-4 border-t">
        <Button variant="ghost" size="sm" onClick={handleReset}>
            <RotateCcw className="w-4 h-4 mr-2" /> Reset
        </Button>
        <Button variant={isLargeText ? "secondary" : "ghost"} size="sm" onClick={() => setIsLargeText(!isLargeText)}>
            <FileText className="w-4 h-4 mr-2" /> {isLargeText ? "Normal Text" : "Large Text"}
        </Button>
        <Button variant={isIVRMode ? "default" : "outline"} size="sm" onClick={() => setIsIVRMode(!isIVRMode)}>
            <Phone className="w-4 h-4 mr-2" /> {isIVRMode ? "Exit IVR" : "IVR Mode"}
        </Button>
      </div>

      {/* EXPLAINER COMPONENT */}
      {showExplanation && currentExplanation && (
        <AIResponseExplainer 
            input={currentExplanation.input}
            agent={currentExplanation.agent}
            ruleEngine={currentExplanation.ruleEngine}
            confidence={currentExplanation.confidence}
            decision={currentExplanation.decision}
            humanVerification={currentExplanation.humanVerification}
        />
      )}

      {/* IVR DEMO COMPONENT */}
      {isIVRMode && (
        <div className="mt-4 p-4 border rounded-xl bg-slate-50 dark:bg-slate-900">
            <h3 className="text-center font-semibold mb-4">Interactive Voice Response Simulation</h3>
            <IVRDemo />
        </div>
      )}

    </div>
  )
}