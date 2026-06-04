import { NextRequest, NextResponse } from 'next/server'
import { fetchHelper } from '@/helpers/fetchHelper'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ vanityPath: string }> },
) {
  try {
    const { vanityPath } = await params
    const formData = await request.json()

    // Make server-to-server call to the external API
    const result = await fetchHelper(`websites/${vanityPath}/contact-form`, {
      method: 'POST',
      body: formData,
    })

    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    console.error('Contact form submission error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to submit contact form' },
      { status: 500 },
    )
  }
}
