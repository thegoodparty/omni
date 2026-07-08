'use client'

import {
  Document,
  Link,
  Page,
  StyleSheet,
  Text,
  View,
} from '@react-pdf/renderer'
import type {
  OpponentBrief,
  OpponentBriefSection,
} from './opponentBriefContent'

const COLOR = {
  primary: '#0a1428',
  muted: '#6b7280',
  divider: '#d1d5db',
  link: '#0048c2',
}

const styles = StyleSheet.create({
  page: {
    paddingVertical: 48,
    paddingHorizontal: 54,
    fontFamily: 'Helvetica',
    fontSize: 11,
    color: COLOR.primary,
    lineHeight: 1.5,
  },
  docHeader: {
    fontSize: 9,
    color: COLOR.muted,
    marginBottom: 16,
  },
  opponent: {
    marginBottom: 8,
  },
  title: {
    fontSize: 20,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 4,
  },
  snapshot: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: COLOR.primary,
    marginBottom: 12,
    paddingBottom: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: COLOR.divider,
    borderBottomStyle: 'solid',
  },
  section: {
    marginBottom: 12,
  },
  // Blue uppercase section labels, echoing the page's DetailSection headings.
  sectionHeading: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: COLOR.link,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 5,
  },
  para: {
    marginBottom: 6,
  },
  bulletRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  bulletDot: {
    width: 12,
  },
  bulletText: {
    flex: 1,
  },
  link: {
    fontSize: 10,
    color: COLOR.link,
    textDecoration: 'underline',
    marginBottom: 6,
  },
  sourceLabel: {
    fontSize: 8,
    fontStyle: 'italic',
    color: COLOR.muted,
    marginTop: 2,
  },
  source: {
    fontSize: 8,
    color: COLOR.muted,
  },
})

// Compact citation lines in print: an italic "source:" label followed by one
// "publisher — url" line per source (no hover carousel, per ENG-10637).
// Shared by every sourced section (overview, background, issues that matter).
const Sources = ({ lines }: { lines: string[] }): React.JSX.Element | null => {
  if (lines.length === 0) return null
  return (
    <View>
      <Text style={styles.sourceLabel}>source:</Text>
      {/* Text keys: a formatted "publisher — url" line is deduped by url
          upstream (sourceLinesFor), so it's unique within this list. */}
      {lines.map((line) => (
        <Text key={line} style={styles.source}>
          {line}
        </Text>
      ))}
    </View>
  )
}

const Bullets = ({ items }: { items: string[] }): React.JSX.Element => (
  <View>
    {/* Index keys: list items are free-text with no uniqueness guarantee, so a
        repeated string would collide on a text-based key and react-pdf would
        silently drop the duplicate. */}
    {items.map((item, index) => (
      <View key={index} style={styles.bulletRow}>
        <Text style={styles.bulletDot}>•</Text>
        <Text style={styles.bulletText}>{item}</Text>
      </View>
    ))}
  </View>
)

const Section = ({
  section,
}: {
  section: OpponentBriefSection
}): React.JSX.Element => {
  switch (section.kind) {
    case 'overview':
      return (
        <View style={styles.section}>
          <Text style={styles.para}>{section.text}</Text>
          {section.websiteUrl ? (
            <Link src={section.websiteUrl} style={styles.link}>
              Campaign website
            </Link>
          ) : null}
          <Sources lines={section.sourceLines} />
        </View>
      )
    case 'whyTheyreRunning':
      return (
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Why they&apos;re running</Text>
          <Text>{section.text}</Text>
        </View>
      )
    case 'background':
      return (
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>Their background</Text>
          <Text>{section.text}</Text>
          <Sources lines={section.sourceLines} />
        </View>
      )
    case 'issuesThatMatter':
      return (
        <View style={styles.section}>
          <Text style={styles.sectionHeading}>
            Issues that matter most to them
          </Text>
          <Bullets items={section.items} />
          <Sources lines={section.sourceLines} />
        </View>
      )
  }
}

// The opponent's identity (name + snapshot line) is not part of the on-page
// summary body — it lives in the accordion row — so it's rendered here as the
// brief header to match what the reader sees on screen.
const OpponentBriefView = ({
  brief,
  breakBefore,
}: {
  brief: OpponentBrief
  breakBefore: boolean
}): React.JSX.Element => (
  <View style={styles.opponent} break={breakBefore}>
    <Text style={styles.title}>{brief.title}</Text>
    {brief.snapshot ? (
      <Text style={styles.snapshot}>{brief.snapshot}</Text>
    ) : null}
    {brief.sections.map((section, index) => (
      <Section key={index} section={section} />
    ))}
  </View>
)

type BriefWithName = { brief: OpponentBrief; opponentName: string }

export const OpponentBriefPdfDocument = ({
  briefs,
  raceContext,
}: {
  briefs: BriefWithName[]
  raceContext?: string
}): React.JSX.Element => (
  <Document title="Opponent brief">
    <Page size="LETTER" style={styles.page}>
      {raceContext ? (
        <Text style={styles.docHeader} fixed>
          {raceContext}
        </Text>
      ) : null}
      {/* Index keys: opponent names carry no uniqueness guarantee, so two
          same-named opponents on a name-based key would collide and one brief
          would be silently dropped. */}
      {briefs.map(({ brief }, index) => (
        <OpponentBriefView key={index} brief={brief} breakBefore={index > 0} />
      ))}
    </Page>
  </Document>
)
