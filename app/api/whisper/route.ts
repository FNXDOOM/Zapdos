// app/api/whisper/route.ts

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import os from 'os';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Supported languages
const SUPPORTED_LANGUAGES = {
  en: 'English',
  hi: 'Hindi',
  ta: 'Tamil',
  te: 'Telugu',
  ml: 'Malayalam',
  kn: 'Kannada',
  bn: 'Bengali',
  gu: 'Gujarati',
  mr: 'Marathi',
  pa: 'Punjabi',
  ur: 'Urdu',
  or: 'Odia',
  as: 'Assamese',
} as const;

type SupportedLanguage = keyof typeof SUPPORTED_LANGUAGES;

// Context prompt
function getContextPrompt(language: SupportedLanguage) {
  const prompts: Record<SupportedLanguage, string> = {
    hi: 'सरकारी सेवाएं, बिजली कटौती, पानी की टंकी, कल्याण योजनाएं, खेती, शिक्षा',
    ta: 'அரசு சேவைகள், மின்வெட்டு, தண்ணீர் தொட்டி, நலத்திட்டங்கள், விவசாயம், கல்வி',
    te: 'ప్రభుత్వ సేవలు, విద్యుత్ కోత, నీటి ట్యాంక్, సంక్షేమ పథకాలు, వ్యవసాయం, విద్య',
    ml: 'സർക്കാർ സേവനങ്ങൾ, വൈദ്യുതി മുടക്കം, വെള്ള ടാങ്ക്, ക്ഷേമ പദ്ധതികൾ, കൃഷി, വിദ്യാഭ്യാസം',
    kn: 'ಸರ್ಕಾರಿ ಸೇವೆಗಳು, ವಿದ್ಯುತ್ ಕಡಿತ, ನೀರಿನ ಟ್ಯಾಂಕ್, ಕಲ್ಯಾಣ ಯೋಜನೆಗಳು, ಕೃಷಿ, ಶಿಕ್ಷಣ',
    bn: 'সরকারি সেবা, বিদ্যুৎ বিভ্রাট, জলের ট্যাংক, কল্যাণ প্রকল্প, কৃষি, শিক্ষা',
    gu: 'સરકારી સેવાઓ, વીજ કાપ, પાણીની ટાંકી, કલ્યાણ યોજનાઓ, ખેતી, શિક્ષણ',
    mr: 'सरकारी सेवा, वीज खंडित, पाण्याची टाकी, कल्याण योजना, शेती, शिक्षण',
    pa: 'ਸਰਕਾਰੀ ਸੇਵਾਵਾਂ, ਬਿਜਲੀ ਕਟੌਤੀ, ਪਾਣੀ ਦੀ ਟੈਂਕੀ, ਭਲਾਈ ਯੋਜਨਾਵਾਂ, ਖੇਤੀ, ਸਿੱਖਿਆ',
    ur: 'سرکاری خدمات، بجلی کی بندش، پانی کا ٹینک، فلاحی اسکیمیں، زراعت، تعلیم',
    or: 'ସରକାରୀ ସେବା, ବିଦ୍ୟୁତ କଟୋତି, ପାଣି ଟାଙ୍କି, କଲ୍ୟାଣ ଯୋଜନା, କୃଷି, ଶିକ୍ଷା',
    as: 'চৰকাৰী সেৱা, বিদ্যুৎ বিভ্ৰাট, পানীৰ টেংকী, কল্যাণ যোজনা, কৃষি, শিক্ষা',
    en: 'Government services, power outage, water tank, welfare schemes, farming, education',
  };

  return prompts[language] || prompts.en;
}

// Language detection using Unicode ranges
function detectLanguagesInText(text: string): string[] {
  const languages = new Set<string>();

  if (/[\u0900-\u097F]/.test(text)) languages.add('Hindi');
  if (/[\u0B80-\u0BFF]/.test(text)) languages.add('Tamil');
  if (/[\u0C00-\u0C7F]/.test(text)) languages.add('Telugu');
  if (/[\u0D00-\u0D7F]/.test(text)) languages.add('Malayalam');
  if (/[\u0C80-\u0CFF]/.test(text)) languages.add('Kannada');
  if (/[\u0980-\u09FF]/.test(text)) languages.add('Bengali / Assamese');
  if (/[\u0A80-\u0AFF]/.test(text)) languages.add('Gujarati');
  if (/[\u0A00-\u0A7F]/.test(text)) languages.add('Punjabi');
  if (/[\u0B00-\u0B7F]/.test(text)) languages.add('Odia');
  if (/[\u0600-\u06FF]/.test(text)) languages.add('Urdu');
  if (/[a-zA-Z]/.test(text)) languages.add('English');

  return Array.from(languages);
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const audioFile = formData.get('audio') as File;
    const language = (formData.get('language') as string) || 'auto';

    if (!audioFile) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
    }

    // MIME validation
    const allowedTypes = [
      'audio/webm',
      'audio/wav',
      'audio/mpeg',
      'audio/mp3',
      'audio/mp4',
      'audio/ogg',
      'audio/x-m4a',
    ];

    if (!allowedTypes.includes(audioFile.type)) {
      return NextResponse.json(
        { error: `Invalid file type: ${audioFile.type}` },
        { status: 400 }
      );
    }

    const maxSize = 25 * 1024 * 1024;
    if (audioFile.size > maxSize) {
      return NextResponse.json({ error: 'File exceeds 25MB limit' }, { status: 400 });
    }

    const normalizedLang = language.toLowerCase().slice(0, 2) as SupportedLanguage;
    const whisperLanguage =
      language !== 'auto' && SUPPORTED_LANGUAGES[normalizedLang]
        ? normalizedLang
        : undefined;

    // Write file to temp directory
    const buffer = Buffer.from(await audioFile.arrayBuffer());
    const tempFilePath = path.join(os.tmpdir(), `${Date.now()}-${audioFile.name}`);
    await fs.promises.writeFile(tempFilePath, buffer);

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: 'whisper-1',
      ...(whisperLanguage ? { language: whisperLanguage } : {}),
      response_format: 'verbose_json',
      prompt: getContextPrompt(whisperLanguage || 'en'),
      temperature: 0,
    });

    fs.unlink(tempFilePath, () => {}); 

    return NextResponse.json({
      success: true,
      transcript: transcription.text,
      language: transcription.language || whisperLanguage || 'unknown',
      detectedLanguages: detectLanguagesInText(transcription.text),
      duration: transcription.duration,
      segments: transcription.segments,
      metadata: {
        fileName: audioFile.name,
        fileSize: audioFile.size,
        autoDetected: !whisperLanguage,
      },
    });
  } catch (err: any) {
    console.error('Whisper API Error:', err);

    if (err?.status === 429) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    if (err?.status === 401) {
      return NextResponse.json({ error: 'Invalid API Key' }, { status: 500 });
    }

    return NextResponse.json(
      { error: err?.message || 'Transcription failed' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'Whisper Transcription API',
    supportedLanguages: SUPPORTED_LANGUAGES,
    features: [
      'Auto language detection',
      'Code-mixed speech support',
      'Word-level timestamps',
      'High accuracy transcription',
    ],
    limits: {
      maxFileSize: '25MB',
      supportedFormats: [
        'webm',
        'wav',
        'mp3',
        'm4a',
        'mp4',
        'ogg',
      ],
    },
  });
}
