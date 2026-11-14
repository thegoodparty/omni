import * as pulumi from '@pulumi/pulumi'

// Settings driven through the Vercel REST API instead of the provider
// (AGENTS.md). The token is read from the environment when a call runs, so it
// never reaches state, and state holds only the fields declared here. A
// preview calls none of these functions for a new resource and only `diff`
// for an existing one. Dynamic resources cannot be imported, so `create`
// adopts: it reads the live value and writes only when it differs.

const vercelApi = async <T>(
  teamId: string,
  method: 'GET' | 'PUT' | 'PATCH',
  path: string,
  body?: object,
): Promise<T> => {
  const response = await fetch(
    `https://api.vercel.com${path}?teamId=${teamId}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${process.env.VERCEL_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    },
  )
  if (!response.ok) {
    throw new Error(
      `Vercel API ${method} ${path} failed: ${response.status} ${await response.text()}`,
    )
  }
  return response.json() as Promise<T>
}

type TeamDefaultProtectionInputs = {
  teamId: string
  deploymentType: string
}

const readTeamDefaultProtection = async (teamId: string) => {
  const team = await vercelApi<{
    defaultDeploymentProtection?: {
      ssoProtection?: { deploymentType: string } | null
    }
  }>(teamId, 'GET', `/v2/teams/${teamId}`)
  return (
    team.defaultDeploymentProtection?.ssoProtection?.deploymentType ?? 'none'
  )
}

const applyTeamDefaultProtection = async ({
  teamId,
  deploymentType,
}: TeamDefaultProtectionInputs) => {
  if ((await readTeamDefaultProtection(teamId)) === deploymentType) {
    return
  }
  await vercelApi(teamId, 'PATCH', `/v2/teams/${teamId}`, {
    defaultDeploymentProtection: {
      ssoProtection: deploymentType === 'none' ? null : { deploymentType },
    },
  })
}

const teamDefaultProtectionProvider: pulumi.dynamic.ResourceProvider<
  TeamDefaultProtectionInputs,
  TeamDefaultProtectionInputs
> = {
  create: async (inputs) => {
    await applyTeamDefaultProtection(inputs)
    return { id: inputs.teamId, outs: inputs }
  },
  read: async (id) => {
    const current = {
      teamId: id,
      deploymentType: await readTeamDefaultProtection(id),
    }
    return { id, props: current }
  },
  diff: async (_id, olds, news) => ({
    changes:
      olds.teamId !== news.teamId ||
      olds.deploymentType !== news.deploymentType,
    replaces: olds.teamId !== news.teamId ? ['teamId'] : [],
  }),
  update: async (_id, _olds, news) => {
    await applyTeamDefaultProtection(news)
    return { outs: news }
  },
}

// Vercel Authentication copied to new projects. `deploymentType` takes the
// API names (`all`, `preview`, `prod_deployment_urls_and_all_previews`,
// `all_except_custom_domains`) or `none`. Deleting this resource leaves the
// setting as it is.
export class TeamDefaultDeploymentProtection extends pulumi.dynamic.Resource {
  constructor(
    name: string,
    args: {
      teamId: pulumi.Input<string>
      deploymentType: pulumi.Input<string>
    },
    opts?: pulumi.CustomResourceOptions,
  ) {
    super(teamDefaultProtectionProvider, name, args, opts)
  }
}

type ObservabilityPlusInputs = {
  teamId: string
  projectId: string
  disabled: boolean
}

const readObservabilityPlusDisabled = async (
  teamId: string,
  projectId: string,
) => {
  const { disabledProjects } = await vercelApi<{
    disabledProjects: { id: string }[]
  }>(teamId, 'GET', '/v1/observability/manage/configuration/projects')
  return disabledProjects.some((project) => project.id === projectId)
}

const applyObservabilityPlus = async ({
  teamId,
  projectId,
  disabled,
}: ObservabilityPlusInputs) => {
  if ((await readObservabilityPlusDisabled(teamId, projectId)) === disabled) {
    return
  }
  await vercelApi(
    teamId,
    'PUT',
    `/v1/observability/manage/configuration/projects/${projectId}`,
    { disabled },
  )
}

const observabilityPlusProvider: pulumi.dynamic.ResourceProvider<
  ObservabilityPlusInputs,
  ObservabilityPlusInputs
> = {
  create: async (inputs) => {
    await applyObservabilityPlus(inputs)
    return { id: `${inputs.teamId}/${inputs.projectId}`, outs: inputs }
  },
  read: async (id) => {
    const [teamId, projectId] = id.split('/')
    const current = {
      teamId,
      projectId,
      disabled: await readObservabilityPlusDisabled(teamId, projectId),
    }
    return { id, props: current }
  },
  diff: async (_id, olds, news) => {
    const moved =
      olds.teamId !== news.teamId || olds.projectId !== news.projectId
    return {
      changes: moved || olds.disabled !== news.disabled,
      replaces: moved ? ['projectId'] : [],
    }
  },
  update: async (_id, _olds, news) => {
    await applyObservabilityPlus(news)
    return { outs: news }
  },
}

// Whether the team's Observability Plus covers a project, which anomaly
// alerts need. Deleting this resource leaves the setting as it is.
export class ObservabilityPlusInclusion extends pulumi.dynamic.Resource {
  constructor(
    name: string,
    args: {
      teamId: pulumi.Input<string>
      projectId: pulumi.Input<string>
      disabled: pulumi.Input<boolean>
    },
    opts?: pulumi.CustomResourceOptions,
  ) {
    super(observabilityPlusProvider, name, args, opts)
  }
}
