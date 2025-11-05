import { NextResponse } from 'next/server';

export async function POST() {
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/stream/direct_upload`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          maxDurationSeconds: 3600,
          requireSignedURLs: false,
        }),
      }
    );

    if (!response.ok) {
      console.error('❌ Error obteniendo upload URL:', response.status);
      return NextResponse.json({ error: 'Error con Cloudflare' }, { status: 500 });
    }

    const data = await response.json();
    
    return NextResponse.json({
      uploadURL: data.result.uploadURL,
      uid: data.result.uid,
    });

  } catch (error) {
    console.error('❌ Error:', error);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}