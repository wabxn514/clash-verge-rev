import { join } from '@tauri-apps/api/path'
import { exists, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { useMemo } from 'react'

import { useProfiles } from '@/hooks/use-profiles'
import { getAppDir } from '@/services/cmds'
import { useQuery } from '@/services/query-client'

export interface ISubscriptionGroup {
  id: string
  name: string
  remark?: string
  uids: string[]
}

export interface ISubscriptionGroupsConfig {
  groups: ISubscriptionGroup[]
}

const getFilePath = async () => {
  const appDir = await getAppDir()
  return await join(appDir, 'subscription_groups.json')
}

export const getSubscriptionGroups = async (
  validUids?: string[],
): Promise<ISubscriptionGroupsConfig> => {
  try {
    const filePath = await getFilePath()
    if (await exists(filePath)) {
      const content = await readTextFile(filePath)
      const data = JSON.parse(content) as ISubscriptionGroupsConfig
      if (data && Array.isArray(data.groups)) {
        // 静默清理无效订阅 UID (即 orphan cleanup)
        if (validUids) {
          const validSet = new Set(validUids)
          let changed = false
          const cleanedGroups = data.groups.map((group) => {
            const filteredUids = group.uids.filter((uid) => validSet.has(uid))
            if (filteredUids.length !== group.uids.length) {
              changed = true
            }
            return { ...group, uids: filteredUids }
          })
          if (changed) {
            const updatedData = { groups: cleanedGroups }
            await writeTextFile(filePath, JSON.stringify(updatedData, null, 2))
            return updatedData
          }
          return { groups: cleanedGroups }
        }
        return data
      }
    }
  } catch (error) {
    console.error('[useSubscriptionGroups] Failed to read groups:', error)
  }
  return { groups: [] }
}

const saveSubscriptionGroups = async (data: ISubscriptionGroupsConfig) => {
  const filePath = await getFilePath()
  await writeTextFile(filePath, JSON.stringify(data, null, 2))
}

export const useSubscriptionGroups = () => {
  const { profiles } = useProfiles()
  const validUids = useMemo(() => {
    return (
      profiles?.items
        ?.filter((item) => item && item.uid)
        .map((item) => item.uid) || []
    )
  }, [profiles])

  const { data, refetch } = useQuery<ISubscriptionGroupsConfig>({
    queryKey: ['getSubscriptionGroups', validUids.join(',')],
    queryFn: () => getSubscriptionGroups(validUids),
    refetchOnWindowFocus: false,
    staleTime: 500,
  })

  const groups = data?.groups || []

  const updateGroupsFile = async (newGroups: ISubscriptionGroup[]) => {
    const config = { groups: newGroups }
    await saveSubscriptionGroups(config)
    await refetch()
  }

  const addGroup = async (name: string, remark?: string) => {
    const id = `group-${Date.now()}`
    const newGroup: ISubscriptionGroup = {
      id,
      name,
      remark,
      uids: [],
    }
    await updateGroupsFile([...groups, newGroup])
    return newGroup
  }

  const updateGroup = async (
    id: string,
    name: string,
    remark?: string,
    uids?: string[],
  ) => {
    const newGroups = groups.map((g) => {
      if (g.id === id) {
        return {
          ...g,
          name,
          remark,
          uids: uids !== undefined ? uids : g.uids,
        }
      }
      return g
    })
    await updateGroupsFile(newGroups)
  }

  const deleteGroup = async (id: string) => {
    const newGroups = groups.filter((g) => g.id !== id)
    await updateGroupsFile(newGroups)
  }

  const setProfileGroup = async (
    profileUid: string,
    groupId: string | null,
  ) => {
    const newGroups = groups.map((g) => {
      // 从其他组移除
      let uids = g.uids.filter((uid) => uid !== profileUid)
      // 如果是目标组，则加入
      if (g.id === groupId) {
        uids = [...uids, profileUid]
      }
      return { ...g, uids }
    })
    await updateGroupsFile(newGroups)
  }

  return {
    groups,
    addGroup,
    updateGroup,
    deleteGroup,
    setProfileGroup,
    refetchGroups: refetch,
  }
}
