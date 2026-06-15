export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const rawBody = await new Promise((resolve) => {
      let data = '';
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => resolve(data));
    });

    console.log('RAW BODY:', rawBody.slice(0, 500));

    let body = {};
    try { body = JSON.parse(rawBody); } catch(e) {
      console.log('Not JSON, raw:', rawBody.slice(0, 200));
    }

    // Extract email data from ReachInbox webhook payload
    const senderName = body?.lead_name || body?.from?.name || body?.lead?.name || 'there';
    const senderEmail = body?.lead_email || body?.from?.email || body?.lead?.email || '';
    const emailSubject = body?.email_subject || body?.subject || '';
    const emailBody = body?.email_sent_body || body?.text || body?.html?.replace(/<[^>]*>/g, '') || '';
    const threadId = body?.thread_id || body?.threadId || '';
    const campaignId = body?.campaign_id || body?.campaignId || '';

    console.log('Parsed - Email:', senderEmail, 'Subject:', emailSubject);

    // Determine gender from name for video link selection
    const firstName = senderName.split(' ')[0];

    // Generate reply using Claude API
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: `You are an email assistant for Boosted Movers LLC, an AI voice agent company for moving companies in the USA & Canada.

COMPANY: Boosted Movers LLC
WEBSITE: boostedmovers.com
CALENDLY: https://calendly.com/boostedmovers/15min
YOUTUBE VIDEO (for women): https://youtu.be/NbdKicZlKR0
LOOM VIDEO (for men): https://www.loom.com/share/4f5715876e134588b4e2ce896a653bf2

PRODUCTS & PRICING:
- Speed-to-Lead Agent (Alex) — $299/month: Calls new leads in under 60 seconds
- Missed Call Assistant (Luci) — $299/month: Handles missed calls and books jobs
- AI Superhero (Max) — $499/month: Full inbound + outbound AI agent with CRM
- White-Glove AI Suite — $1,500/month: Enterprise package with full customization
- Setup fee: $1,800 (one-time, includes CRM integration)
- Money-back guarantee included

KEY RESULTS: Saves 10+ hours/week, calls leads in 30 seconds, reduces missed calls, boosts bookings.
TARGET: Moving companies with 5-20 trucks in USA & Canada.

YOUR MAIN GOAL: Get the prospect to book a 15-minute call via Calendly.

RESPONSE RULES:
1. Analyze the incoming email carefully and respond to exactly what they said
2. Always personalize — use their name, reference what they wrote
3. Keep replies SHORT (3-6 sentences max)
4. Always include the Calendly link: https://calendly.com/boostedmovers/15min
5. Never use generic templates — make every reply feel human and specific
6. Tone: friendly, confident, direct — not salesy or pushy

SITUATION HANDLING:
- "Call me" (phone number provided): Say Daria will call them. Don't push Calendly.
- "Call me" (no phone number): Ask for their number and best time.
- Asking for info/sample: Send the appropriate video link (YouTube for women, Loom for men), then invite to Calendly call.
- Asking for price: "$299/month for a single agent. One mover in CA booked $30k in extra jobs after rolling this out." then push Calendly.
- Has a competitor / already has a solution: Acknowledge it, say AI usually complements existing tools for missed/after-hours calls, then Calendly.
- Busy / contact later: Acknowledge, leave the video link, keep the door open.
- Wants to pick their own time: Send Calendly link directly.
- Cancelled / no-show: Friendly follow-up, suggest 2 time options, offer Calendly.
- General interest: Briefly explain value, push Calendly.

SENDER INFO:
- First name: ${firstName}
- Full name: ${senderName}
- Email: ${senderEmail}

Always sign off as:
Best,
Daria
Boosted Movers
boostedmovers.com`,
        messages: [
          {
            role: 'user',
            content: `Incoming email:
Subject: ${emailSubject}

Body:
${emailBody}

Write a reply email. Return ONLY the email body text, no subject line, no extra commentary.`
          }
        ]
      })
    });

    const claudeText = await claudeResponse.text();
    console.log('Claude raw response:', claudeText.slice(0, 300));

    let claudeData;
    try {
      claudeData = JSON.parse(claudeText);
    } catch(e) {
      console.error('Claude API returned non-JSON:', claudeText.slice(0, 200));
      return res.status(500).json({ error: 'Claude API error: ' + claudeText.slice(0, 200) });
    }

    const replyText = claudeData?.content?.[0]?.text || '';

    if (!replyText) {
      console.error('Claude returned empty response:', JSON.stringify(claudeData));
      return res.status(500).json({ error: 'Claude returned empty response' });
    }

    console.log('Reply text:', replyText.slice(0, 200));

    // Send reply via ReachInbox API
    const reachInboxResponse = await fetch('https://api.reachinbox.ai/api/v1/onebox/emails/reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.REACHINBOX_API_KEY}`
      },
      body: JSON.stringify({
        threadId: threadId,
        campaignId: campaignId,
        replyText: replyText,
        to: senderEmail
      })
    });

    const reachInboxText = await reachInboxResponse.text();
    console.log('ReachInbox response:', reachInboxText.slice(0, 300));

    return res.status(200).json({
      success: true,
      replySentTo: senderEmail,
      replyPreview: replyText.slice(0, 100) + '...'
    });

  } catch (error) {
    console.error('Webhook error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
