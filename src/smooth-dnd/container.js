import { hasClass, addClass, removeClass, addChildAt, removeChildAt } from './utils';
import {
	defaultGroupName,
	wrapperClass,
	animationClass,
	stretcherElementClass,
	extraSizeForInsertion,
	translationValue,
	containerClass
} from './constants';
import layoutManager from './layoutManager';
import Mediator from './mediator';
import './container.css';

const defaultOptions = {
	groupName: defaultGroupName,
	behaviour: 'move', // move | copy
	acceptGroups: [defaultGroupName],
	orientation: 'vertical', // vertical | horizontal
	getChildPayload: () => { return undefined; }
};

function initOptions(props = defaultOptions) {
	const result = Object.assign({}, defaultOptions, props);
	if (result.groupName && !props.acceptGroups) {
		result.acceptGroups = [props.groupName];
	}
	return result;
}

function isDragRelevant({ element, options }) {
	return function(draggableInfo) {
		const hasMoveBehaviour = options.behaviour === 'move';
		return hasMoveBehaviour && (draggableInfo.container.element === element ||
			draggableInfo.groupName === options.groupName ||
			options.acceptGroups.indexOf(draggableInfo.groupName) > -1);
	};
}

function wrapChild(child, orientation) {
	const div = document.createElement('div');
	div.className = `${wrapperClass} ${animationClass} ${orientation}`;
	child.parentElement.insertBefore(div, child);
	div.appendChild(child);
	return div;
}

function wrapChildren(element, orientation) {
	const draggables = Array.prototype.map.call(element.children, child => {
		let wrapper = child;
		if (!hasClass(child, wrapperClass)) {
			wrapper = wrapChild(child, orientation);
		}
		return wrapper;
	});
	return draggables;
}

function applyDrop({ element, draggables, layout, options }) {
	return function(draggableInfo, removeIndex, addIndex, payload, droppedElement) {
		if (removeIndex !== null) {
			removeChildAt(element, removeIndex);
			draggables.splice(removeIndex, 1);
		}

		if (addIndex !== null) {
			const wrapper = document.createElement('div');
			wrapper.className = `${wrapperClass} ${animationClass} ${options.orientation}`;
			wrapper.appendChild(droppedElement.cloneNode(true));
			addChildAt(element, wrapper, addIndex);
			if (addIndex >= draggables.length) {
				draggables.push(wrapper);
			} else {
				draggables.splice(addIndex, 0, wrapper);
			}
		}
	}
}

function findDraggebleAtPos({ layout }) {
	const find = (draggables, pos, startIndex, endIndex, withRespectToMiddlePoints = false) => {
		if (endIndex < startIndex) {
			return startIndex;
		}
		// binary serach draggable
		if (startIndex === endIndex) {
			let { begin, end } = layout.getBeginEnd(draggables[startIndex]);
			// mouse pos is inside draggable
			// now decide which index to return
			if (pos > begin && pos <= end) {
				if (withRespectToMiddlePoints) {
					return (pos < ((end + begin) / 2)) ? startIndex : startIndex + 1;
				} else {
					return startIndex;
				}
			} else {
				return null;
			}
		} else {
			const middleIndex = Math.floor((endIndex + startIndex) / 2);
			const { begin, end } = layout.getBeginEnd(draggables[middleIndex]);
			if (pos < begin) {
				return find(draggables, pos, startIndex, middleIndex - 1, withRespectToMiddlePoints);
			} else if (pos > end) {
				return find(draggables, pos, middleIndex + 1, endIndex, withRespectToMiddlePoints);
			} else {
				if (withRespectToMiddlePoints) {
					return (pos < ((end + begin) / 2)) ? middleIndex : middleIndex + 1;
				} else {
					return middleIndex;
				}
			}
		}
	};

	return (draggables, pos, withRespectToMiddlePoints = false) => {
		return find(draggables, pos, 0, draggables.length - 1, withRespectToMiddlePoints);
	};
}

function resetDraggables({ element, draggables, layout }) {
	return function() {
		draggables.forEach(p => {
			removeClass(p, animationClass);
			layout.setTranslation(p, 0);
			layout.setVisibility(p, true);
		});

		setTimeout(() => {
			draggables.forEach(p => {
				addClass(p, animationClass);
			});
		}, 50);
	};
}

function setTargetContainer(draggableInfo, element, set = true) {
	if (element && set) {
		draggableInfo.targetElement = element;
	} else {
		if (draggableInfo.targetElement === element) {
			draggableInfo.targetElement = null;
		}
	}
}

function handleRemoveItem({ element, options, draggables, layout }) {
	let removedIndex = null;
	let elementSize = null;
	let containerStretcherElement = null;
	return function(draggableInfo) {
		if (removedIndex === null && draggableInfo.container.element === element && options.behaviour === 'move') {
			removedIndex = draggableInfo.elementIndex;
			layout.setVisibility(draggables[removedIndex], false);
		}
		if (elementSize === null) {
			elementSize = layout.getSize(draggableInfo.element);
		}
		const pos = layout.isInVisibleRect(draggableInfo.position) ? layout.getAxisValue(draggableInfo.position) : null;
		setTargetContainer(draggableInfo, element, !!pos);
		if (pos === null) {
			elementSize = null;
		}

		return {
			pos,
			removedIndex,
			elementSize,
			invalidateShadow: draggableInfo.invalidateShadow
		};
	};
}

function handleAddItem({ element, draggables, layout }) {
	let addedIndex = null;
	let shadowBeginEnd = null;
	const getNextAddedIndex = getDragInsertionIndex({ draggables, layout });
	const getShadowBounds = getShadowBeginEnd({ draggables, layout });
	const translate = calculateTranslations({ element, draggables, layout });
	return function(draggableInfo) {
		const { pos, removedIndex, elementSize, invalidateShadow } = draggableInfo;
		if (pos === null) {
			addedIndex = null;
			shadowBeginEnd = null;
			translate({ addedIndex, removedIndex, elementSize });
		} else {
			if (invalidateShadow) {
				shadowBeginEnd = getShadowBounds(addedIndex, removedIndex, elementSize);
			}
			let nextAddedIndex = getNextAddedIndex(shadowBeginEnd, pos);
			if (nextAddedIndex === null) {
				nextAddedIndex = addedIndex;
			}
			if (addedIndex !== nextAddedIndex) {
				translate({ addedIndex: nextAddedIndex, removedIndex, elementSize });
				shadowBeginEnd = getShadowBounds(nextAddedIndex, removedIndex, elementSize);

				if (addedIndex === null) {
					// handle first insert exceptional boundaries of shadow
					if (pos < shadowBeginEnd.begin) shadowBeginEnd.begin = pos - 5;
					if (pos > shadowBeginEnd.end) shadowBeginEnd.end = pos + 5;
				}

				addedIndex = nextAddedIndex;
			}
		}
		return {
			addedIndex,
			removedIndex,
			elementSize,
			shadowBeginEnd
		};
	};
}

function compose(options) {
	return function(...functions) {
		const hydratedFunctions = functions.map(p => p(options));
		return function(data) {
			return hydratedFunctions.reduce((value, fn) => {
				return fn(value);
			}, data);
		};
	};
}

function handleDrop({ element, draggables, layout, options }) {
	const draggablesReset = resetDraggables({ element, draggables, layout });
	const dropHandler = applyDrop({ element, draggables, layout, options });
	return function(draggableInfo, { addedIndex, removedIndex }) {
		draggablesReset();
		// if drop zone is valid => complete drag else do nothing everything will be reverted by draggablesReset()
		if (draggableInfo.targetElement) {
			let actualAddIndex = addedIndex !== null ? ((removedIndex !== null && removedIndex < addedIndex) ? addedIndex - 1 : addedIndex) : null;
			options.onDrop && options.onDrop(draggableInfo, actualAddIndex, removedIndex, draggableInfo.payload, draggableInfo.element);
			dropHandler(draggableInfo, removedIndex, actualAddIndex, draggableInfo.payload, draggableInfo.element.firstChild);
			console.log(removedIndex, actualAddIndex, draggableInfo.payload, draggableInfo.element.firstChild);
		}
	};
}

function handleInsertionSizeChange({ element, draggables, layout }) {
	let lastRemovedIndex = null;
	let lastAddedIndex = null;
	let strectherElement = null;
	let stretcherElementAdded = false;

	return function({ addedIndex, removedIndex, elementSize }, reset = false) {
		if (reset) {
			element[extraSizeForInsertion] = 0;
			if (strectherElement) {
				element.removeChild(strectherElement);
				strectherElement = null;
			}
		} else {
			if (removedIndex === null) {
				if (addedIndex !== null) {
					element[extraSizeForInsertion] = elementSize / 2;
					if (!stretcherElementAdded) {
						const containerBeginEnd = layout.getBeginEndOfContainer();
						const hasScrollBar = layout.getScrollSize(element) > layout.getSize(element);
						const containerEnd = hasScrollBar ? (containerBeginEnd.begin + layout.getScrollSize(element) - layout.getScrollValue(element)) : containerBeginEnd.end;
						const lastDraggableEnd = layout.getBeginEnd(draggables[draggables.length - 1]).end - draggables[draggables.length - 1][translationValue];
						if (lastDraggableEnd + elementSize > containerEnd) {
							strectherElement = document.createElement('div');
							strectherElement.className = stretcherElementClass;
							layout.setSize(strectherElement.style, ((elementSize + lastDraggableEnd) - containerEnd) + 'px');
							element.appendChild(strectherElement);
						}
						stretcherElementAdded = true;
					}
				} else {
					element[extraSizeForInsertion] = 0;
					if (strectherElement) {
						layout.setTranslation(strectherElement, 0);
						let toRemove = strectherElement;
						strectherElement = null;
						element.removeChild(toRemove);
						setTimeout(function() {
						}, 180);
					}
					stretcherElementAdded = false;
				}
			}
		}
	}
}

function getContainerProps(element, initialOptions) {
	const options = initOptions(initialOptions);
	const draggables = wrapChildren(element, options.orientation);
	// set flex classes before layout is inited for scroll listener
	addClass(element, `${containerClass} ${options.orientation}`);
	const layout = layoutManager(element, options.orientation);
	return {
		element,
		draggables,
		options,
		layout
	};
}

function Container(element) {
	return function(options) {
		let dragResult = null;
		let lastDraggableInfo = null;
		const props = getContainerProps(element, options);
		let dragHandler = getDragHandler(props);
		let dropHandler = handleDrop(props);
		let insertionStretcherHandler = handleInsertionSizeChange(props);

		function processLastDraggableInfo() {
			if (lastDraggableInfo !== null) {
				lastDraggableInfo.invalidateShadow = true;
				dragResult = dragHandler(lastDraggableInfo);
				lastDraggableInfo.invalidateShadow = false;
			}
		}

		props.layout.setScrollListener(function() {
			processLastDraggableInfo();
		});

		return {
			element,
			draggables: props.draggables,
			isDragRelevant: isDragRelevant(props),
			getScale: props.layout.getContainerScale,
			getChildPayload: props.options.getChildPayload,
			groupName: props.options.groupName,
			layout: props.layout,
			handleDrag: function(draggableInfo) {
				lastDraggableInfo = draggableInfo;
				dragResult = dragHandler(draggableInfo);
				insertionStretcherHandler(dragResult);
			},
			handleDrop: function(draggableInfo) {
				lastDraggableInfo = null;
				dragHandler = getDragHandler(props);
				insertionStretcherHandler({}, true);
				return dropHandler(draggableInfo, dragResult);
			},
			getDragResult: function() {
				return dragResult;
			},
			getTranslateCalculator: function(...params) {
				return withState(calculateTranslations(props))(...params);
			},
			invalidateRect: function() {
				props.layout.invalidate();
				processLastDraggableInfo();
			},
			getBehaviour: function() {
				return props.options.behaviour;
			}
		};
	};
}

export default function(element, options) {
	const containerIniter = Container(element);
	const container = containerIniter(options);
	Mediator.register(container);
	return {
		setOptions: containerIniter,
		invalidateRect: function() {
			container.invalidateRect();
		},
		dispose: function() {
			container.layout.dispose();
		}
	};
}

function getRemovedItem({ draggables, element, options }) {
	return ({ draggableInfo, dragResult, state }) => {
		let removedIndex = state.removedIndex;
		if (state.removedIndex == null && draggableInfo.container.element === element && options.behaviour === 'move') {
			removedIndex = draggableInfo.elementIndex
		}

		return { removedIndex };
	}
}

function setRemovedItemVisibilty({ draggables, layout }) {
	return ({ draggableInfo, dragResult, state }) => {
		if (dragResult.removedIndex !== null && state.removedIndex == null) {
			layout.setVisibility(draggables[dragResult.removedIndex], false);
		}
		return { removedIndex: dragResult.removedIndex };
	}
}

function getPosition({ layout }) {
	return ({ draggableInfo, dragResult, state }) => {
		return layout.isInVisibleRect(draggableInfo.position) ? {
			pos: layout.getAxisValue(draggableInfo.position)
		} : null;
	}
}

function getElementSize({ layout }) {
	return ({ draggableInfo, dragResult, state }) => {
		if (dragResult.pos === null) {
			return null;
		} else {
			return { elementSize: state.elementSize || layout.getSize(draggableInfo.element) };
		}
	}
}

function setTargetContainer({ element }) {
	return ({ draggableInfo, dragResult, state }) => {
		setTargetContainer(draggableInfo, element, !!dragResult.pos);
	}
}

function getShadowBeginEnd({ draggables, layout }) {
	return ({ draggableInfo, dragResult, state }) => {
		const { addedIndex, removedIndex, elementSize, pos } = dragResult;
		if (pos !== null && addedIndex !== null) {

			let beforeIndex = addedIndex - 1;
			let begin = 0;
			let afterBounds = null;
			let beforeBounds = null;
			if (beforeIndex === removedIndex) {
				beforeIndex--;
			}
			if (beforeIndex > -1) {
				const beforeSize = layout.getSize(draggables[beforeIndex]);
				beforeBounds = layout.getBeginEnd(draggables[beforeIndex]);
				if (elementSize < beforeSize) {
					const threshold = (beforeSize - elementSize) / 2;
					begin = beforeBounds.end - threshold;
				} else {
					begin = beforeBounds.end;
				}
			} else {
				beforeBounds = { end: layout.getBeginEndOfContainer().begin };
			}

			let end = 10000;
			let afterIndex = addedIndex;
			if (afterIndex === removedIndex) {
				afterIndex++;
			}
			if (afterIndex < draggables.length) {
				const afterSize = layout.getSize(draggables[afterIndex]);
				afterBounds = layout.getBeginEnd(draggables[afterIndex]);

				if (elementSize < afterSize) {
					const threshold = (afterSize - elementSize) / 2;
					end = afterBounds.begin + threshold;
				} else {
					end = afterBounds.begin;
				}
			} else {
				afterBounds = { begin: layout.getContainerRectangles().end };
			}

			const shadowRectTopLeft = beforeBounds && afterBounds ? layout.getTopLeftOfElementBegin(beforeBounds.end, afterBounds.begin) : null;

			return {
				shadowBeginEnd: {
					begin,
					end,
					rect: shadowRectTopLeft
				}
			};
		} else {
			return null;
		}
	};
}

function getDragInsertionIndex({ draggables, layout }) {
	const findDraggable = findDraggebleAtPos({ layout });
	return ({ dragResult: { shadowBeginEnd, pos } }) => {
		let addedIndex = null;
		if (!shadowBeginEnd) {
			const index = findDraggable(draggables, pos, true);
			return { addedIndex: index !== null ? index : draggables.length };
		} else {
			if (shadowBeginEnd.begin <= pos && shadowBeginEnd.end >= pos) {
				// position inside ghost
				return {
					addedIndex: null
				};
			}
		}

		if (pos < shadowBeginEnd.begin) {
			return {
				addedIndex: findDraggable(draggables, pos)
			}
		} else if (pos > shadowBeginEnd.end) {
			return {
				addedIndex: findDraggable(draggables, pos) + 1
			}
		} else {
			return {
				addedIndex: draggables.length
			}
		}
	};
}


function calculateTranslations({ element, draggables, layout }) {
	return function({ dragResult: { addedIndex, removedIndex, elementSize, shadowBeginEnd }, state }) {
		if (addedIndex !== state.addedIndex || removedIndex !== state.removedIndex) {
			for (let index = 0; index < draggables.length; index++) {
				const draggable = draggables[index];
				let translate = 0;
				if (removedIndex !== null && removedIndex < index) {
					translate -= layout.getSize(draggables[removedIndex]);
				}
				if (addedIndex !== null && addedIndex <= index) {
					translate += elementSize;
				}
				layout.setTranslation(draggable, translate);
			}
		}
	};
}

function invalidateShadowBeginEnd(params) {
	const shadowBoundsGetter = getShadowBeginEnd(params);
	return ({ draggableInfo: { invalidateShadow }, dragResult }) => {
		if (invalidateShadow) {
			return {
				shadowBeginEnd: shadowBoundsGetter({dragResult})
			}
		}
		return null;
	}
}

function getDragHandler(params) {
	return compose(
		params,
		getRemovedItem,
		setRemovedItemVisibilty,
		getPosition,
		getElementSize,
		setTargetContainer,
		invalidateShadowBeginEnd,
		getDragInsertionIndex,
		getShadowBeginEnd,
		calculateTranslations
	);
}


function withState(fn) {
	const state = getDefaultDragResult();
	return (params) => {
		params.state = state;
		const result = fn(params);
		Object.assign(state, result);
		return Object.assign(params.dragResult, result);
	}
}

function getDefaultDragResult() {
	return {
		addedIndex: null,
		removedIndex: null,
		elementSize: null,
		pos: null,
		shadowBeginEnd: null
	}
}

function compose(params, ...functions) {
	const hydratedFunctions = functions.map(p => withState(p(params)));
	return (draggableInfo) => {
		return hydratedFunctions.reduce((dragResult, fn) => {
			return Object.assign(dragResult, fn({ draggableInfo, dragResult }));
		}, getDefaultDragResult());
	}
}

