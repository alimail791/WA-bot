// VasulBook WhatsApp message texts in 10 languages. The same words are used for
//   • the approved Meta templates (outside WhatsApp's 24-hour window), and
//   • free messages with a button (inside the window).
// Placeholders: welcome/verify {{1}} name {{2}} business · refer {{1}} name {{2}} months {{3}} link · missyou {{1}} name {{2}} days
export const APP_URL = 'https://www.vasulbook.com/app';
export const REFER_URL = 'https://www.vasulbook.com/app#/refer';
export const KINDS = ['welcome', 'verify', 'refer', 'missyou'];
export const CATEGORY = { welcome: 'UTILITY', verify: 'UTILITY', refer: 'MARKETING', missyou: 'MARKETING' };
export const NAME = (kind) => `vasulbook_${kind}`;
// Example values Meta asks for when a template is submitted
export const EXAMPLE = { welcome: ['Ravi', 'Sri Lakshmi Stores'], verify: ['Ravi', 'Sri Lakshmi Stores'], refer: ['Ravi', '5', 'https://www.vasulbook.com/?ref=VB12AB34'], missyou: ['Ravi', '6'] };

export const T = {
  en: {
    welcome: 'Hi {{1}}, welcome to VasulBook! 🎉 Your udhaar book for {{2}} is ready. Add your first customer and send a polite WhatsApp reminder with your UPI ID in one tap. Any question, just reply here.',
    verify: 'Hi {{1}}, please confirm your details for {{2}} on VasulBook so your ledger stays safe. Tap "Yes, my number" below to confirm this WhatsApp number. If your email is not confirmed yet, open the app and enter the 6-digit code we emailed you.',
    refer: 'Hi {{1}}, enjoying VasulBook? Invite another shop or business owner. For every friend who joins with your link, you get {{2}} months free. Your link: {{3}} Thank you for spreading the word! 🙏',
    missyou: 'Hi {{1}}, we miss you at VasulBook! It has been {{2}} days since you last opened your ledger. Note today\'s udhaar and send reminders, so your money comes back on time. 💰',
    footer: 'VasulBook · Reply STOP to stop messages',
    open: 'Open VasulBook', yes: 'Yes, my number', share: 'Share my link',
    thanks: '✅ Thank you! Your WhatsApp number is confirmed for {shop}.',
    stopped: 'You will not get VasulBook messages on WhatsApp any more. Reply START to turn them back on.',
    started: 'VasulBook messages are on again. Reply STOP anytime to stop.',
    help: 'This is VasulBook. Open the app below to see your ledger and send reminders. For help, write to info@vasulbook.com. Reply STOP to stop VasulBook messages.',
  },
  hi: {
    welcome: 'नमस्ते {{1}}, VasulBook में आपका स्वागत है! 🎉 {{2}} की उधार बही तैयार है। पहला ग्राहक जोड़ें और एक टैप में अपने UPI ID के साथ विनम्र WhatsApp रिमाइंडर भेजें। कोई सवाल हो तो यहीं जवाब दें।',
    verify: 'नमस्ते {{1}}, VasulBook पर {{2}} की जानकारी कन्फर्म करें ताकि आपका खाता सुरक्षित रहे। इस WhatsApp नंबर को कन्फर्म करने के लिए नीचे "हाँ, मेरा नंबर" दबाएं। अगर ईमेल कन्फर्म नहीं है, तो ऐप खोलें और ईमेल पर भेजा 6 अंकों का कोड डालें।',
    refer: 'नमस्ते {{1}}, VasulBook पसंद आ रहा है? किसी और दुकान या व्यापारी को बुलाएं। आपके लिंक से जुड़ने वाले हर दोस्त पर आपको {{2}} महीने मुफ्त मिलेंगे। आपका लिंक: {{3}} शेयर करने के लिए धन्यवाद! 🙏',
    missyou: 'नमस्ते {{1}}, VasulBook पर आपकी कमी महसूस हो रही है! आपने {{2}} दिन से अपना खाता नहीं खोला। आज का उधार लिखें और रिमाइंडर भेजें, ताकि आपका पैसा समय पर वापस आए। 💰',
    footer: 'VasulBook · मैसेज बंद करने के लिए STOP लिखें',
    open: 'VasulBook खोलें', yes: 'हाँ, मेरा नंबर', share: 'मेरा लिंक शेयर करें',
    thanks: '✅ धन्यवाद! {shop} के लिए आपका WhatsApp नंबर कन्फर्म हो गया।',
    stopped: 'अब आपको WhatsApp पर VasulBook के मैसेज नहीं मिलेंगे। फिर से चालू करने के लिए START लिखें।',
    started: 'VasulBook के मैसेज फिर से चालू हैं। बंद करने के लिए कभी भी STOP लिखें।',
    help: 'यह VasulBook है। खाता देखने और रिमाइंडर भेजने के लिए नीचे ऐप खोलें। मदद के लिए info@vasulbook.com पर लिखें। मैसेज बंद करने के लिए STOP लिखें।',
  },
  ta: {
    welcome: 'வணக்கம் {{1}}, VasulBook-க்கு வரவேற்கிறோம்! 🎉 {{2}}-க்கான உங்கள் கடன் புத்தகம் தயார். முதல் வாடிக்கையாளரைச் சேர்த்து, ஒரே தட்டலில் உங்கள் UPI ID-யுடன் மரியாதையான WhatsApp நினைவூட்டல் அனுப்புங்கள். ஏதாவது சந்தேகம் என்றால் இங்கேயே பதில் அனுப்புங்கள்.',
    verify: 'வணக்கம் {{1}}, உங்கள் கணக்கு பாதுகாப்பாக இருக்க VasulBook-இல் {{2}} விவரங்களை உறுதிசெய்யுங்கள். இந்த WhatsApp எண்ணை உறுதிசெய்ய கீழே "ஆம், என் எண்" என்பதைத் தட்டுங்கள். மின்னஞ்சல் இன்னும் உறுதிசெய்யப்படவில்லை என்றால், செயலியைத் திறந்து மின்னஞ்சலில் அனுப்பிய 6 இலக்கக் குறியீட்டை உள்ளிடுங்கள்.',
    refer: 'வணக்கம் {{1}}, VasulBook பிடித்திருக்கிறதா? இன்னொரு கடை அல்லது வியாபாரியை அழையுங்கள். உங்கள் இணைப்பு மூலம் சேரும் ஒவ்வொரு நண்பருக்கும் உங்களுக்கு {{2}} மாதங்கள் இலவசம். உங்கள் இணைப்பு: {{3}} பகிர்ந்ததற்கு நன்றி! 🙏',
    missyou: 'வணக்கம் {{1}}, VasulBook-இல் உங்களைக் காணவில்லை! நீங்கள் கணக்கைத் திறந்து {{2}} நாட்கள் ஆகிவிட்டன. இன்றைய கடனை எழுதி நினைவூட்டல் அனுப்புங்கள், உங்கள் பணம் சரியான நேரத்தில் திரும்பி வரும். 💰',
    footer: 'VasulBook · செய்திகளை நிறுத்த STOP என அனுப்பவும்',
    open: 'VasulBook திற', yes: 'ஆம், என் எண்', share: 'என் இணைப்பைப் பகிர்',
    thanks: '✅ நன்றி! {shop}-க்கான உங்கள் WhatsApp எண் உறுதிசெய்யப்பட்டது.',
    stopped: 'இனி WhatsApp-இல் VasulBook செய்திகள் வராது. மீண்டும் பெற START என அனுப்புங்கள்.',
    started: 'VasulBook செய்திகள் மீண்டும் தொடங்கின. நிறுத்த எப்போது வேண்டுமானாலும் STOP அனுப்புங்கள்.',
    help: 'இது VasulBook. கணக்கைப் பார்க்கவும் நினைவூட்டல் அனுப்பவும் கீழே செயலியைத் திறக்கவும். உதவிக்கு info@vasulbook.com-க்கு எழுதுங்கள். செய்திகளை நிறுத்த STOP அனுப்புங்கள்.',
  },
  te: {
    welcome: 'నమస్తే {{1}}, VasulBookకి స్వాగతం! 🎉 {{2}} కోసం మీ అప్పు పుస్తకం సిద్ధంగా ఉంది. మొదటి కస్టమర్‌ను జోడించి, ఒక్క ట్యాప్‌తో మీ UPI IDతో మర్యాదపూర్వక WhatsApp రిమైండర్ పంపండి. ఏదైనా సందేహం ఉంటే ఇక్కడే రిప్లై ఇవ్వండి.',
    verify: 'నమస్తే {{1}}, మీ ఖాతా సురక్షితంగా ఉండేందుకు VasulBookలో {{2}} వివరాలను ధృవీకరించండి. ఈ WhatsApp నంబర్‌ను ధృవీకరించడానికి కింద "అవును, నా నంబర్" నొక్కండి. ఈమెయిల్ ఇంకా ధృవీకరించకపోతే, యాప్ తెరిచి ఈమెయిల్‌లో పంపిన 6 అంకెల కోడ్ నమోదు చేయండి.',
    refer: 'నమస్తే {{1}}, VasulBook నచ్చిందా? మరో దుకాణం లేదా వ్యాపారిని ఆహ్వానించండి. మీ లింక్‌తో చేరే ప్రతి స్నేహితుడికి మీకు {{2}} నెలలు ఉచితం. మీ లింక్: {{3}} షేర్ చేసినందుకు ధన్యవాదాలు! 🙏',
    missyou: 'నమస్తే {{1}}, VasulBookలో మీరు కనిపించడం లేదు! మీరు ఖాతా తెరిచి {{2}} రోజులు అయింది. ఈరోజు అప్పు రాసి రిమైండర్లు పంపండి, మీ డబ్బు సమయానికి తిరిగి వస్తుంది. 💰',
    footer: 'VasulBook · మెసేజ్‌లు ఆపడానికి STOP పంపండి',
    open: 'VasulBook తెరవండి', yes: 'అవును, నా నంబర్', share: 'నా లింక్ షేర్ చేయండి',
    thanks: '✅ ధన్యవాదాలు! {shop} కోసం మీ WhatsApp నంబర్ ధృవీకరించబడింది.',
    stopped: 'ఇకపై WhatsAppలో VasulBook మెసేజ్‌లు రావు. మళ్ళీ పొందడానికి START పంపండి.',
    started: 'VasulBook మెసేజ్‌లు మళ్ళీ మొదలయ్యాయి. ఆపడానికి ఎప్పుడైనా STOP పంపండి.',
    help: 'ఇది VasulBook. ఖాతా చూడటానికి, రిమైండర్లు పంపడానికి కింద యాప్ తెరవండి. సహాయం కోసం info@vasulbook.comకి రాయండి. మెసేజ్‌లు ఆపడానికి STOP పంపండి.',
  },
  kn: {
    welcome: 'ನಮಸ್ಕಾರ {{1}}, VasulBookಗೆ ಸ್ವಾಗತ! 🎉 {{2}}ಗಾಗಿ ನಿಮ್ಮ ಸಾಲದ ಪುಸ್ತಕ ಸಿದ್ಧವಾಗಿದೆ. ಮೊದಲ ಗ್ರಾಹಕರನ್ನು ಸೇರಿಸಿ, ಒಂದೇ ಟ್ಯಾಪ್‌ನಲ್ಲಿ ನಿಮ್ಮ UPI ID ಜೊತೆಗೆ ವಿನಯದ WhatsApp ನೆನಪೋಲೆ ಕಳುಹಿಸಿ. ಏನಾದರೂ ಪ್ರಶ್ನೆ ಇದ್ದರೆ ಇಲ್ಲೇ ಉತ್ತರಿಸಿ.',
    verify: 'ನಮಸ್ಕಾರ {{1}}, ನಿಮ್ಮ ಖಾತೆ ಸುರಕ್ಷಿತವಾಗಿರಲು VasulBookನಲ್ಲಿ {{2}} ವಿವರಗಳನ್ನು ದೃಢೀಕರಿಸಿ. ಈ WhatsApp ಸಂಖ್ಯೆಯನ್ನು ದೃಢೀಕರಿಸಲು ಕೆಳಗೆ "ಹೌದು, ನನ್ನ ಸಂಖ್ಯೆ" ಒತ್ತಿ. ಇಮೇಲ್ ಇನ್ನೂ ದೃಢೀಕರಿಸದಿದ್ದರೆ, ಆ್ಯಪ್ ತೆರೆದು ಇಮೇಲ್‌ನಲ್ಲಿ ಕಳುಹಿಸಿದ 6 ಅಂಕಿಯ ಕೋಡ್ ನಮೂದಿಸಿ.',
    refer: 'ನಮಸ್ಕಾರ {{1}}, VasulBook ಇಷ್ಟವಾಯಿತೇ? ಇನ್ನೊಂದು ಅಂಗಡಿ ಅಥವಾ ವ್ಯಾಪಾರಿಯನ್ನು ಆಹ್ವಾನಿಸಿ. ನಿಮ್ಮ ಲಿಂಕ್ ಮೂಲಕ ಸೇರುವ ಪ್ರತಿ ಸ್ನೇಹಿತರಿಗೆ ನಿಮಗೆ {{2}} ತಿಂಗಳು ಉಚಿತ. ನಿಮ್ಮ ಲಿಂಕ್: {{3}} ಹಂಚಿಕೊಂಡಿದ್ದಕ್ಕೆ ಧನ್ಯವಾದ! 🙏',
    missyou: 'ನಮಸ್ಕಾರ {{1}}, VasulBookನಲ್ಲಿ ನಿಮ್ಮನ್ನು ಮಿಸ್ ಮಾಡುತ್ತಿದ್ದೇವೆ! ನೀವು ಖಾತೆ ತೆರೆದು {{2}} ದಿನಗಳಾಗಿವೆ. ಇಂದಿನ ಸಾಲ ಬರೆದು ನೆನಪೋಲೆ ಕಳುಹಿಸಿ, ನಿಮ್ಮ ಹಣ ಸಮಯಕ್ಕೆ ಮರಳಿ ಬರುತ್ತದೆ. 💰',
    footer: 'VasulBook · ಸಂದೇಶ ನಿಲ್ಲಿಸಲು STOP ಕಳುಹಿಸಿ',
    open: 'VasulBook ತೆರೆಯಿರಿ', yes: 'ಹೌದು, ನನ್ನ ಸಂಖ್ಯೆ', share: 'ನನ್ನ ಲಿಂಕ್ ಹಂಚಿ',
    thanks: '✅ ಧನ್ಯವಾದ! {shop}ಗಾಗಿ ನಿಮ್ಮ WhatsApp ಸಂಖ್ಯೆ ದೃಢೀಕರಿಸಲಾಗಿದೆ.',
    stopped: 'ಇನ್ನು ಮುಂದೆ WhatsAppನಲ್ಲಿ VasulBook ಸಂದೇಶಗಳು ಬರುವುದಿಲ್ಲ. ಮತ್ತೆ ಪಡೆಯಲು START ಕಳುಹಿಸಿ.',
    started: 'VasulBook ಸಂದೇಶಗಳು ಮತ್ತೆ ಆರಂಭವಾಗಿವೆ. ನಿಲ್ಲಿಸಲು ಯಾವಾಗ ಬೇಕಾದರೂ STOP ಕಳುಹಿಸಿ.',
    help: 'ಇದು VasulBook. ಖಾತೆ ನೋಡಲು ಮತ್ತು ನೆನಪೋಲೆ ಕಳುಹಿಸಲು ಕೆಳಗೆ ಆ್ಯಪ್ ತೆರೆಯಿರಿ. ಸಹಾಯಕ್ಕೆ info@vasulbook.comಗೆ ಬರೆಯಿರಿ. ಸಂದೇಶ ನಿಲ್ಲಿಸಲು STOP ಕಳುಹಿಸಿ.',
  },
  ml: {
    welcome: 'നമസ്കാരം {{1}}, VasulBook-ലേക്ക് സ്വാഗതം! 🎉 {{2}}-നുള്ള നിങ്ങളുടെ കടം പുസ്തകം തയ്യാർ. ആദ്യ ഉപഭോക്താവിനെ ചേർത്ത്, ഒറ്റ ടാപ്പിൽ നിങ്ങളുടെ UPI ID സഹിതം മര്യാദയുള്ള WhatsApp ഓർമ്മപ്പെടുത്തൽ അയയ്ക്കൂ. എന്തെങ്കിലും സംശയമുണ്ടെങ്കിൽ ഇവിടെ മറുപടി അയയ്ക്കൂ.',
    verify: 'നമസ്കാരം {{1}}, നിങ്ങളുടെ കണക്ക് സുരക്ഷിതമായിരിക്കാൻ VasulBook-ൽ {{2}}-ന്റെ വിവരങ്ങൾ സ്ഥിരീകരിക്കുക. ഈ WhatsApp നമ്പർ സ്ഥിരീകരിക്കാൻ താഴെ "അതെ, എന്റെ നമ്പർ" ടാപ്പ് ചെയ്യുക. ഇമെയിൽ ഇനിയും സ്ഥിരീകരിച്ചിട്ടില്ലെങ്കിൽ, ആപ്പ് തുറന്ന് ഇമെയിലിൽ അയച്ച 6 അക്ക കോഡ് നൽകുക.',
    refer: 'നമസ്കാരം {{1}}, VasulBook ഇഷ്ടമായോ? മറ്റൊരു കടക്കാരനെയോ വ്യാപാരിയെയോ ക്ഷണിക്കൂ. നിങ്ങളുടെ ലിങ്ക് വഴി ചേരുന്ന ഓരോ സുഹൃത്തിനും നിങ്ങൾക്ക് {{2}} മാസം സൗജന്യം. നിങ്ങളുടെ ലിങ്ക്: {{3}} പങ്കിട്ടതിന് നന്ദി! 🙏',
    missyou: 'നമസ്കാരം {{1}}, VasulBook-ൽ നിങ്ങളെ കാണുന്നില്ല! നിങ്ങൾ കണക്ക് തുറന്നിട്ട് {{2}} ദിവസമായി. ഇന്നത്തെ കടം എഴുതി ഓർമ്മപ്പെടുത്തലുകൾ അയയ്ക്കൂ, നിങ്ങളുടെ പണം സമയത്ത് തിരിച്ചെത്തും. 💰',
    footer: 'VasulBook · സന്ദേശങ്ങൾ നിർത്താൻ STOP അയയ്ക്കുക',
    open: 'VasulBook തുറക്കുക', yes: 'അതെ, എന്റെ നമ്പർ', share: 'എന്റെ ലിങ്ക് പങ്കിടുക',
    thanks: '✅ നന്ദി! {shop}-നുള്ള നിങ്ങളുടെ WhatsApp നമ്പർ സ്ഥിരീകരിച്ചു.',
    stopped: 'ഇനി WhatsApp-ൽ VasulBook സന്ദേശങ്ങൾ വരില്ല. വീണ്ടും ലഭിക്കാൻ START അയയ്ക്കുക.',
    started: 'VasulBook സന്ദേശങ്ങൾ വീണ്ടും തുടങ്ങി. നിർത്താൻ എപ്പോൾ വേണമെങ്കിലും STOP അയയ്ക്കുക.',
    help: 'ഇത് VasulBook ആണ്. കണക്ക് കാണാനും ഓർമ്മപ്പെടുത്തൽ അയയ്ക്കാനും താഴെ ആപ്പ് തുറക്കുക. സഹായത്തിന് info@vasulbook.com-ൽ എഴുതുക. സന്ദേശങ്ങൾ നിർത്താൻ STOP അയയ്ക്കുക.',
  },
  mr: {
    welcome: 'नमस्कार {{1}}, VasulBook मध्ये आपले स्वागत आहे! 🎉 {{2}} ची उधारी वही तयार आहे. पहिला ग्राहक जोडा आणि एका टॅपमध्ये तुमच्या UPI ID सह नम्र WhatsApp रिमाइंडर पाठवा. काही प्रश्न असल्यास इथेच उत्तर द्या.',
    verify: 'नमस्कार {{1}}, तुमचे खाते सुरक्षित राहण्यासाठी VasulBook वर {{2}} ची माहिती कन्फर्म करा. हा WhatsApp नंबर कन्फर्म करण्यासाठी खाली "हो, माझा नंबर" दाबा. ईमेल अजून कन्फर्म नसेल तर ॲप उघडा आणि ईमेलवर पाठवलेला 6 अंकी कोड टाका.',
    refer: 'नमस्कार {{1}}, VasulBook आवडतंय? दुसऱ्या दुकानदाराला किंवा व्यापाऱ्याला आमंत्रित करा. तुमच्या लिंकने जोडल्या जाणाऱ्या प्रत्येक मित्रामागे तुम्हाला {{2}} महिने मोफत. तुमची लिंक: {{3}} शेअर केल्याबद्दल धन्यवाद! 🙏',
    missyou: 'नमस्कार {{1}}, VasulBook वर तुमची आठवण येते! तुम्ही खाते उघडून {{2}} दिवस झाले. आजची उधारी लिहा आणि रिमाइंडर पाठवा, म्हणजे तुमचे पैसे वेळेवर परत येतील. 💰',
    footer: 'VasulBook · मेसेज बंद करण्यासाठी STOP पाठवा',
    open: 'VasulBook उघडा', yes: 'हो, माझा नंबर', share: 'माझी लिंक शेअर करा',
    thanks: '✅ धन्यवाद! {shop} साठी तुमचा WhatsApp नंबर कन्फर्म झाला.',
    stopped: 'आता WhatsApp वर VasulBook चे मेसेज येणार नाहीत. पुन्हा सुरू करण्यासाठी START पाठवा.',
    started: 'VasulBook चे मेसेज पुन्हा सुरू झाले. बंद करण्यासाठी कधीही STOP पाठवा.',
    help: 'हे VasulBook आहे. खाते पाहण्यासाठी आणि रिमाइंडर पाठवण्यासाठी खाली ॲप उघडा. मदतीसाठी info@vasulbook.com वर लिहा. मेसेज बंद करण्यासाठी STOP पाठवा.',
  },
  bn: {
    welcome: 'নমস্কার {{1}}, VasulBook-এ স্বাগতম! 🎉 {{2}}-এর বাকির খাতা তৈরি। প্রথম গ্রাহক যোগ করুন এবং এক ট্যাপে আপনার UPI ID সহ ভদ্র WhatsApp রিমাইন্ডার পাঠান। কোনো প্রশ্ন থাকলে এখানেই উত্তর দিন।',
    verify: 'নমস্কার {{1}}, আপনার খাতা নিরাপদ রাখতে VasulBook-এ {{2}}-এর তথ্য নিশ্চিত করুন। এই WhatsApp নম্বর নিশ্চিত করতে নিচে "হ্যাঁ, আমার নম্বর" চাপুন। ইমেল এখনও নিশ্চিত না হলে, অ্যাপ খুলে ইমেলে পাঠানো ৬ অঙ্কের কোড দিন।',
    refer: 'নমস্কার {{1}}, VasulBook ভালো লাগছে? আরেকজন দোকানদার বা ব্যবসায়ীকে আমন্ত্রণ জানান। আপনার লিঙ্কে যোগ দেওয়া প্রতিটি বন্ধুর জন্য আপনি {{2}} মাস বিনামূল্যে পাবেন। আপনার লিঙ্ক: {{3}} শেয়ার করার জন্য ধন্যবাদ! 🙏',
    missyou: 'নমস্কার {{1}}, VasulBook-এ আপনাকে মিস করছি! আপনি খাতা খোলেননি {{2}} দিন হলো। আজকের বাকি লিখুন আর রিমাইন্ডার পাঠান, যাতে আপনার টাকা সময়মতো ফেরে। 💰',
    footer: 'VasulBook · মেসেজ বন্ধ করতে STOP পাঠান',
    open: 'VasulBook খুলুন', yes: 'হ্যাঁ, আমার নম্বর', share: 'আমার লিঙ্ক শেয়ার',
    thanks: '✅ ধন্যবাদ! {shop}-এর জন্য আপনার WhatsApp নম্বর নিশ্চিত হয়েছে।',
    stopped: 'এখন থেকে WhatsApp-এ VasulBook-এর মেসেজ আসবে না। আবার চালু করতে START পাঠান।',
    started: 'VasulBook-এর মেসেজ আবার চালু হয়েছে। বন্ধ করতে যেকোনো সময় STOP পাঠান।',
    help: 'এটি VasulBook। খাতা দেখতে ও রিমাইন্ডার পাঠাতে নিচে অ্যাপ খুলুন। সাহায্যের জন্য info@vasulbook.com-এ লিখুন। মেসেজ বন্ধ করতে STOP পাঠান।',
  },
  gu: {
    welcome: 'નમસ્તે {{1}}, VasulBook માં આપનું સ્વાગત છે! 🎉 {{2}} ની ઉધાર ચોપડી તૈયાર છે. પહેલો ગ્રાહક ઉમેરો અને એક ટૅપમાં તમારા UPI ID સાથે નમ્ર WhatsApp રિમાઇન્ડર મોકલો. કોઈ પ્રશ્ન હોય તો અહીં જ જવાબ આપો.',
    verify: 'નમસ્તે {{1}}, તમારું ખાતું સુરક્ષિત રહે તે માટે VasulBook પર {{2}} ની વિગતો કન્ફર્મ કરો. આ WhatsApp નંબર કન્ફર્મ કરવા નીચે "હા, મારો નંબર" દબાવો. ઈમેલ હજી કન્ફર્મ ન હોય તો એપ ખોલો અને ઈમેલમાં મોકલેલો 6 અંકનો કોડ નાખો.',
    refer: 'નમસ્તે {{1}}, VasulBook ગમે છે? બીજા દુકાનદાર કે વેપારીને આમંત્રણ આપો. તમારી લિંકથી જોડાતા દરેક મિત્ર માટે તમને {{2}} મહિના મફત. તમારી લિંક: {{3}} શેર કરવા બદલ આભાર! 🙏',
    missyou: 'નમસ્તે {{1}}, VasulBook પર તમારી યાદ આવે છે! તમે ખાતું ખોલ્યાને {{2}} દિવસ થયા. આજની ઉધારી લખો અને રિમાઇન્ડર મોકલો, જેથી તમારા પૈસા સમયસર પાછા આવે. 💰',
    footer: 'VasulBook · મેસેજ બંધ કરવા STOP મોકલો',
    open: 'VasulBook ખોલો', yes: 'હા, મારો નંબર', share: 'મારી લિંક શેર કરો',
    thanks: '✅ આભાર! {shop} માટે તમારો WhatsApp નંબર કન્ફર્મ થયો.',
    stopped: 'હવે WhatsApp પર VasulBook ના મેસેજ નહીં આવે. ફરી ચાલુ કરવા START મોકલો.',
    started: 'VasulBook ના મેસેજ ફરી ચાલુ થયા. બંધ કરવા ક્યારેય પણ STOP મોકલો.',
    help: 'આ VasulBook છે. ખાતું જોવા અને રિમાઇન્ડર મોકલવા નીચે એપ ખોલો. મદદ માટે info@vasulbook.com પર લખો. મેસેજ બંધ કરવા STOP મોકલો.',
  },
  pa: {
    welcome: 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ {{1}}, VasulBook ਵਿੱਚ ਜੀ ਆਇਆਂ ਨੂੰ! 🎉 {{2}} ਦੀ ਉਧਾਰ ਵਹੀ ਤਿਆਰ ਹੈ। ਪਹਿਲਾ ਗਾਹਕ ਜੋੜੋ ਅਤੇ ਇੱਕ ਟੈਪ ਵਿੱਚ ਆਪਣੇ UPI ID ਨਾਲ ਨਿਮਰ WhatsApp ਰਿਮਾਈਂਡਰ ਭੇਜੋ। ਕੋਈ ਸਵਾਲ ਹੋਵੇ ਤਾਂ ਇੱਥੇ ਹੀ ਜਵਾਬ ਦਿਓ।',
    verify: 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ {{1}}, ਆਪਣਾ ਖਾਤਾ ਸੁਰੱਖਿਅਤ ਰੱਖਣ ਲਈ VasulBook \'ਤੇ {{2}} ਦੀ ਜਾਣਕਾਰੀ ਪੱਕੀ ਕਰੋ। ਇਹ WhatsApp ਨੰਬਰ ਪੱਕਾ ਕਰਨ ਲਈ ਹੇਠਾਂ "ਹਾਂ, ਮੇਰਾ ਨੰਬਰ" ਦਬਾਓ। ਜੇ ਈਮੇਲ ਅਜੇ ਪੱਕੀ ਨਹੀਂ, ਤਾਂ ਐਪ ਖੋਲ੍ਹੋ ਅਤੇ ਈਮੇਲ \'ਤੇ ਭੇਜਿਆ 6 ਅੰਕਾਂ ਦਾ ਕੋਡ ਪਾਓ।',
    refer: 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ {{1}}, VasulBook ਪਸੰਦ ਆ ਰਿਹਾ ਹੈ? ਕਿਸੇ ਹੋਰ ਦੁਕਾਨਦਾਰ ਜਾਂ ਵਪਾਰੀ ਨੂੰ ਸੱਦਾ ਦਿਓ। ਤੁਹਾਡੇ ਲਿੰਕ ਨਾਲ ਜੁੜਨ ਵਾਲੇ ਹਰ ਦੋਸਤ \'ਤੇ ਤੁਹਾਨੂੰ {{2}} ਮਹੀਨੇ ਮੁਫ਼ਤ। ਤੁਹਾਡਾ ਲਿੰਕ: {{3}} ਸਾਂਝਾ ਕਰਨ ਲਈ ਧੰਨਵਾਦ! 🙏',
    missyou: 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ {{1}}, VasulBook \'ਤੇ ਤੁਹਾਡੀ ਯਾਦ ਆ ਰਹੀ ਹੈ! ਤੁਹਾਨੂੰ ਖਾਤਾ ਖੋਲ੍ਹੇ {{2}} ਦਿਨ ਹੋ ਗਏ। ਅੱਜ ਦਾ ਉਧਾਰ ਲਿਖੋ ਅਤੇ ਰਿਮਾਈਂਡਰ ਭੇਜੋ, ਤਾਂ ਜੋ ਤੁਹਾਡਾ ਪੈਸਾ ਸਮੇਂ ਸਿਰ ਵਾਪਸ ਆਵੇ। 💰',
    footer: 'VasulBook · ਮੈਸੇਜ ਬੰਦ ਕਰਨ ਲਈ STOP ਭੇਜੋ',
    open: 'VasulBook ਖੋਲ੍ਹੋ', yes: 'ਹਾਂ, ਮੇਰਾ ਨੰਬਰ', share: 'ਮੇਰਾ ਲਿੰਕ ਸਾਂਝਾ ਕਰੋ',
    thanks: '✅ ਧੰਨਵਾਦ! {shop} ਲਈ ਤੁਹਾਡਾ WhatsApp ਨੰਬਰ ਪੱਕਾ ਹੋ ਗਿਆ।',
    stopped: 'ਹੁਣ WhatsApp \'ਤੇ VasulBook ਦੇ ਮੈਸੇਜ ਨਹੀਂ ਆਉਣਗੇ। ਮੁੜ ਚਾਲੂ ਕਰਨ ਲਈ START ਭੇਜੋ।',
    started: 'VasulBook ਦੇ ਮੈਸੇਜ ਮੁੜ ਚਾਲੂ ਹਨ। ਬੰਦ ਕਰਨ ਲਈ ਕਦੇ ਵੀ STOP ਭੇਜੋ।',
    help: 'ਇਹ VasulBook ਹੈ। ਖਾਤਾ ਦੇਖਣ ਅਤੇ ਰਿਮਾਈਂਡਰ ਭੇਜਣ ਲਈ ਹੇਠਾਂ ਐਪ ਖੋਲ੍ਹੋ। ਮਦਦ ਲਈ info@vasulbook.com \'ਤੇ ਲਿਖੋ। ਮੈਸੇਜ ਬੰਦ ਕਰਨ ਲਈ STOP ਭੇਜੋ।',
  },
};
export const LANGS = Object.keys(T);
export const tr = (lang) => T[lang] || T.en;
export const fill = (text, params) => text.replace(/\{\{(\d+)\}\}/g, (m, i) => (params[i - 1] !== undefined ? String(params[i - 1]) : m));

// Meta template definition for one kind and language (POST /{waba}/message_templates)
export function definition(kind, lang) {
  const t = tr(lang);
  const buttons = kind === 'verify'
    ? [{ type: 'QUICK_REPLY', text: t.yes }, { type: 'URL', text: t.open, url: APP_URL }]
    : kind === 'refer' ? [{ type: 'URL', text: t.share, url: REFER_URL }]
      : [{ type: 'URL', text: t.open, url: APP_URL }];
  return {
    name: NAME(kind), language: lang, category: CATEGORY[kind],
    components: [
      { type: 'BODY', text: t[kind], example: { body_text: [EXAMPLE[kind]] } },
      { type: 'FOOTER', text: t.footer },
      { type: 'BUTTONS', buttons },
    ],
  };
}
