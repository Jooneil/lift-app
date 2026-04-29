import { usePullToRefresh } from './usePullToRefresh';
import PullDumbbell from './PullDumbbell';

type Props = { onRefresh: () => void };

export default function PullToRefresh({ onRefresh }: Props) {
  const state = usePullToRefresh(onRefresh);
  return <PullDumbbell state={state} />;
}
