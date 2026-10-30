const formatMoney = (amount: number) => `USD ${amount.toFixed(2)}`

const Refunds = (props: { amount: number }) => (
  <main><h1>Refunds</h1><p>{formatMoney(props.amount)}</p></main>
)

export default Refunds
