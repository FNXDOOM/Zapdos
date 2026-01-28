// app/api/whisper/route.ts

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Configuration for supported languages
const SUPPORTED_LANGUAGES = {
  'en': 'English',
  'hi': 'Hindi',
  'ta': 'Tamil',
  'te': 'Telugu',
  'ml': 'Malayalam',
  'kn': 'Kannada',
  'bn': 'Bengali',
  'gu': 'Gujarati',
  'mr': 'Marathi',
  'pa': 'Punjabi',
  'ur': 'Urdu',
  'or': 'Odia',
  'as': 'Assamese',
} as const;

type SupportedLanguage = keyof typeof SUPPORTED_LANGUAGES;

// Context prompts for better transcription accuracy
function getContextPrompt(language: string): string {
  const prompts: Record<string, string> = {
    'hi': 'सरकारी सेवाएं, बिजली कटौती, पानी की टंकी, कल्याण योजनाएं, खेती, शिक्षा',
    'ta': 'அரசு சேவைகள், மின்வெட்டு, தண்ணீர் தொட்டி, நலத்திட்டங்கள், விவசாயம், கல்வி',
    'te': 'ప్రభుత్వ సేవలు, విద్యుత్ కోత, నీటి ట్యాంక్, సంక్షేమ పథకాలు, వ్యవసాయం, విద్య',
    'ml': 'സർക്കാർ സേവനങ്ങൾ, വൈദ്യുതി മുടക്കം, വെള്ള ടാങ്ക്, ക്ഷേമ പദ്ധതികൾ, കൃഷി, വിദ്യാഭ്യാസം',
    'kn': 'ಸರ್ಕಾರಿ ಸೇವೆಗಳು, ವಿದ್ಯುತ್ ಕಡಿತ, ನೀರಿನ ಟ್ಯಾಂಕ್, ಕಲ್ಯಾಣ ಯೋಜನೆಗಳು, ಕೃಷಿ, ಶಿಕ್ಷಣ',
    'bn': 'সরকারি সেবা, বিদ্যুৎ বিভ্রাট, জলের ট্যাংক, কল্যাণ প্রকল্প, কৃষি, শিক্ষা',
    'gu': 'સરકારી સેવાઓ, વીજ કાપ, પાણીની ટાંકી, કલ્યાણ યોજનાઓ, ખેતી, શિક્ષણ',
    'mr': 'सरकारी सेवा, वीज खंडित, पाण्याची टाकी, कल्याण योजना, शेती, शिक्षण',
    'pa': 'ਸਰਕਾਰੀ ਸੇਵਾਵਾਂ, ਬਿਜਲੀ ਕਟੌਤੀ, ਪਾਣੀ ਦੀ ਟੈਂਕੀ, ਭਲਾਈ ਯੋਜਨਾਵਾਂ, ਖੇਤੀ, ਸਿੱਖਿਆ',
    'en': 'Government services, power outage, water tank, welfare schemes, farming, education',
  };
  return prompts[language] || prompts['en'];
}

// Detect languages from text based on character ranges
function detectLanguagesInText(text: string): string[] {
  const languages = new Set<string>();
  
  if (/[\u0900-\u097F]/.test(text)) languages.add('Hindi');
  if (/[\u0B80-\u0BFF]/.test(text)) languages.add('Tamil');
  if (/[\u0C00-\u0C7F]/.test(text)) languages.add('Telugu');
  if (/[\u0D00-\u0D7F]/.test(text)) languages.add('Malayalam');
  if (/[\u0C80-\u0CFF]/.test(text)) languages.add('Kannada');
  if (/[\u0980-\u09FF]/.test(text)) languages.add('Bengali');
  if (/[\u0A80-\u0AFF]/.test(text)) languages.add('Gujarati');
  if (/[\u0A00-\u0A7F]/.test(text)) languages.add('Punjabi');
  if (/[a-zA-Z]/.test(text)) languages.add('English');
  
  return Array.from(languages);
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get('audio') as File;
    const language = formData.get('language') as string;
    const useAutoDetect = !language || language === 'auto';

    // Validation
    if (!audioFile) {
      return NextResponse.json(
        { error: 'No audio file provided' },
        { status: 400 }
      );
    }

    // Validate file type
    const validTypes = ['audio/webm', 'audio/wav', 'audio/mp3', 'audio/m4a', 'audio/mpeg', 'audio/ogg'];
    if (!validTypes.some(type => audioFile.type.includes(type.split('/')[1]))) {
      return NextResponse.json(
        { error: `Invalid file type: ${audioFile.type}. Supported types: webm, wav, mp3, m4a, ogg` },
        { status: 400 }
      );
    }

    // Validate file size (Whisper API has a 25MB limit)
    const maxSize = 25 * 1024 * 1024; // 25MB
    if (audioFile.size > maxSize) {
      return NextResponse.json(
        { error: `File too large: ${(audioFile.size / 1024 / 1024).toFixed(2)}MB. Maximum: 25MB` },
        { status: 400 }
      );
    }

    // Normalize language code
    const normalizedLang = language?.toLowerCase().slice(0, 2) as SupportedLanguage;
    const whisperLanguage = SUPPORTED_LANGUAGES[normalizedLang] ? normalizedLang : undefined;

    console.log(`Transcribing audio: ${audioFile.name} (${(audioFile.size / 1024).toFixed(2)}KB)`, {
      requestedLanguage: language,
      autoDetect: useAutoDetect,
      whisperLanguage
    });

    // Prepare context prompt based on language
    const contextPrompt = whisperLanguage ? getContextPrompt(whisperLanguage) : getContextPrompt('en');

    // Call OpenAI Whisper API
    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      // Only set language if not auto-detecting
      ...(whisperLanguage && !useAutoDetect ? { language: whisperLanguage } : {}),
      response_format: 'verbose_json', // Get detailed response with timestamps
      prompt: contextPrompt, // Context improves accuracy
      temperature: 0, // More deterministic results
    });

    // Detect all languages present in the transcript
    const detectedLanguages = detectLanguagesInText(transcription.text);

    console.log(`Transcription successful:`, {
      textLength: transcription.text.length,
      detectedLanguage: transcription.language,
      detectedLanguages,
      duration: transcription.duration,
      preview: transcription.text.substring(0, 100)
    });

    // Return comprehensive transcription data
    return NextResponse.json({
      success: true,
      transcript: transcription.text,
      language: transcription.language || whisperLanguage || 'unknown',
      detectedLanguages, // All languages found in the text
      duration: transcription.duration,
      segments: transcription.segments, // Word-level timestamps
      metadata: {
        fileSize: audioFile.size,
        fileName: audioFile.name,
        autoDetected: useAutoDetect,
      }
    });

  } catch (error: any) {
    console.error('Whisper API error:', error);
    
    // Handle specific OpenAI errors
    if (error.status === 429) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again in a moment.' },
        { status: 429 }
      );
    }
    
    if (error.status === 401) {
      return NextResponse.json(
        { error: 'Invalid API key configuration. Please contact support.' },
        { status: 500 }
      );
    }

    if (error.code === 'insufficient_quota') {
      return NextResponse.json(
        { error: 'API quota exceeded. Please contact support.' },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { 
        error: error.message || 'Transcription failed',
        details: process.env.NODE_ENV === 'development' ? error.toString() : undefined
      },
      { status: 500 }
    );
  }
}

// Optional: GET endpoint for testing and status
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'Whisper Transcription API',
    supportedLanguages: Object.entries(SUPPORTED_LANGUAGES).map(([code, name]) => ({
      code,
      name
    })),
    features: [
      'Auto language detection',
      'Multi-language support (99+ languages)',
      'Code-mixing support (Hinglish, Tanglish, etc.)',
      'Word-level timestamps',
      'High accuracy transcription'
    ],
    limits: {
      maxFileSize: '25MB',
      supportedFormats: ['audio/webm', 'audio/wav', 'audio/mp3', 'audio/m4a', 'audio/mpeg', 'audio/ogg']
    }
  });
}