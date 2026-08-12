import { STEPS_BY_TYPE } from 'app/dashboard/shared/constants/tasks.const'

export const getFlowStepsByType = (type: string) => () => STEPS_BY_TYPE[type]
