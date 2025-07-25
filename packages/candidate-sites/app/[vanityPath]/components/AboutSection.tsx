export default function AboutSection({
  activeTheme,
  content,
}: {
  activeTheme: any
  content: any
}) {
  return (
    <section
      id="about"
      className={`mx-auto max-w-4xl py-10 px-4 ${activeTheme.bg} scroll-mt-16`}
    >
      <h2 className="font-semibold text-2xl mb-4">About</h2>
      <p className="mb-6">{content?.about?.bio || ''}</p>
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

        {(!content?.about?.issues || content?.about?.issues?.length === 0) &&
          Array(4)
            .fill(0)
            .map((_, index) => (
              <div
                key={index}
                className={`p-4 rounded-lg ${activeTheme.secondary} text-center`}
              >
                <h3 className="font-medium">Add Policy Issues</h3>
                <p className="text-sm mt-1">in the editor</p>
              </div>
            ))}
      </div>
    </section>
  )
}
