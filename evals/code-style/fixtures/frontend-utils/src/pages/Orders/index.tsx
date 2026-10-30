const formatMoney = (amount: number) => `USD ${amount.toFixed(2)}`
const formatOrderStatus = (isOverdue: boolean) => isOverdue ? 'Overdue' : 'Current'

const Orders = (props: { amount: number; isOverdue: boolean }) => (
  <main><h1>Orders</h1><p>{formatMoney(props.amount)}</p><span>{formatOrderStatus(props.isOverdue)}</span></main>
)

export default Orders
