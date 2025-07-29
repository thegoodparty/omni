import { Element } from 'react-scroll'
import { WEBSITE_SECTIONS } from '../constants/websiteNavigation.const'

export default function AboutSection({
  activeTheme,
  content,
}: {
  activeTheme: any
  content: any
}) {
  return (
    <section
      className={`mx-auto max-w-4xl py-10 px-4 ${activeTheme.bg} scroll-mt-16`}
    >
      <Element name={WEBSITE_SECTIONS.ABOUT}>
        <h2 className="font-semibold text-2xl mb-4">About</h2>
        <p className="mb-6" dangerouslySetInnerHTML={{ __html: content?.about?.bio || '' }} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {content?.about?.issues?.map(
            (issue: { title: string; description: string }, index: number) => (
              <div
                key={index}
                className={`p-4 rounded-lg ${activeTheme.secondary} text-center`}
              >
                <h3 className="font-medium">{issue.title}</h3>
                <p className="text-sm mt-1">{issue.description}</p>
              </div>
            ),
          )}          
        </div>
      </Element>
    </section>
  )
}
