import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Upload a Cloudflare Stream
    const cloudflareFormData = new FormData();
    cloudflareFormData.append('file', file);

    const uploadResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/stream`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
        },
        body: cloudflareFormData,
      }
    );

    const result = await uploadResponse.json();

    if (!result.success) {
      console.error('Cloudflare error:', result);
      return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
    }

    return NextResponse.json({
      videoId: result.result.uid,
      thumbnailUrl: `https://customer-${process.env.CLOUDFLARE_ACCOUNT_ID}.cloudflarestream.com/${result.result.uid}/thumbnails/thumbnail.jpg?time=1s&width=400`,
      streamUrl: `https://customer-${process.env.CLOUDFLARE_ACCOUNT_ID}.cloudflarestream.com/${result.result.uid}/iframe`,
    });

  } catch (error) {
    console.error('Error uploading to Cloudflare:', error);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutos