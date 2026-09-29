'use client'

import React from 'react'

interface TextingComplianceFormProps {
  children: React.ReactNode
  // The default bottom padding clears the fixed TextingComplianceFooter; a
  // caller drawing its own inline footer passes its own classes instead.
  className?: string
}

export default function TextingComplianceForm({
  children,
  className = 'pb-16 md:p-0 flex flex-col gap-4',
}: TextingComplianceFormProps): React.JSX.Element {
  return <form className={className}>{children}</form>
}
