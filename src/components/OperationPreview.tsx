import type { Operation } from '@dsl/types';

interface OperationPreviewProps {
  operations: Operation[];
  onClear: () => void;
}

function getOperationTypeClass(type: string): string {
  switch (type) {
    case 'navigate': return 'navigate';
    case 'click': return 'click';
    case 'type': return 'type';
    case 'screenshot': return 'screenshot';
    case 'wait': return 'wait';
    default: return '';
  }
}

function formatOperationDetails(op: Operation): JSX.Element {
  switch (op.type) {
    case 'navigate':
      return <span>URL: <code>{op.url}</code></span>;
    case 'click':
      return <span>Selector: <code>{op.selector}</code></span>;
    case 'type':
      return (
        <span>
          Selector: <code>{op.selector}</code><br />
          Text: <code>{op.text}</code>
        </span>
      );
    case 'screenshot':
      return <span>Name: <code>{op.name || 'unnamed'}</code></span>;
    case 'wait':
      if (op.selector) {
        return <span>Selector: <code>{op.selector}</code></span>;
      }
      return <span>Duration: <code>{op.duration}ms</code></span>;
    case 'hover':
      return <span>Selector: <code>{op.selector}</code></span>;
    case 'select':
      return (
        <span>
          Selector: <code>{op.selector}</code><br />
          Value: <code>{op.value}</code>
        </span>
      );
    case 'press':
      return <span>Key: <code>{op.key}</code></span>;
    default:
      return <span>{JSON.stringify(op)}</span>;
  }
}

export default function OperationPreview({ operations, onClear }: OperationPreviewProps) {
  return (
    <div className="operation-preview">
      <div className="preview-header">
        <div className="preview-title">
          Recorded Operations
          <span className="preview-count">{operations.length}</span>
        </div>
        {operations.length > 0 && (
          <button className="clear-btn" onClick={onClear}>
            Clear All
          </button>
        )}
      </div>

      <div className="operation-list">
        {operations.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">◇</div>
            <div className="empty-state-text">
              No operations recorded yet.<br />
              Start interacting with the browser to record operations.
            </div>
          </div>
        ) : (
          operations.map((op, index) => (
            <div key={op.id} className="operation-item">
              <div className="operation-header">
                <span className={`operation-type ${getOperationTypeClass(op.type)}`}>
                  {op.type.toUpperCase()}
                </span>
                <span className="operation-id">#{index + 1}</span>
              </div>
              <div className="operation-details">
                {formatOperationDetails(op)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

