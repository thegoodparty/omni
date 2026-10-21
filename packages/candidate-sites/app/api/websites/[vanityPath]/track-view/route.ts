import { NextRequest, NextResponse } from 'next/server'
import { fetchHelper } from '@/helpers/fetchHelper'
import { clientAddressHeaders } from '@/helpers/clientAddress'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ vanityPath: string }> },
) {
  try {
    const { vanityPath } = await params
    const body = await request.json()

    const result = await fetchHelper(`websites/${vanityPath}/track-view`, {
      method: 'POST',
      body,
      headers: clientAddressHeaders(request),
    })

    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    console.error('Website view tracking error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to track view' },
      { status: 500 },
    )
  }
}
