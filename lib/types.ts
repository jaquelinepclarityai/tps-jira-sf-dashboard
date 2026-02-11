export interface JiraTicket {
  id: string
  key: string
  summary: string
  status: string
  priority: string
  assignee: string | null
  reporter: string
  owner: string | null
  created: string
  updated: string
  dueDate: string | null
  type: string
  url: string
}

export interface SalesforceOpportunity {
  id: string
  name: string
  stageName: string
  accessMethod: string
  amount: number | null
  closeDate: string
  accountName: string
  ownerName: string
  probability: number | null
  createdDate: string
  lastModifiedDate: string
  url: string
}

export interface DashboardStats {
  total: number
  byStatus: Record<string, number>
}
