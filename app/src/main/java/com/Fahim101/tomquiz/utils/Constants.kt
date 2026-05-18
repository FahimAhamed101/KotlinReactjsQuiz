package com.Fahim101.tomquiz.utils

import com.Fahim101.tomquiz.R
import com.Fahim101.tomquiz.model.Question


object Constants {

    const val USER_NAME = "user_name"
    const val TOTAL_QUESTIONS = "total_questions"
    const val SCORE = "correct_answers"

    fun getQuestions(): MutableList<Question> {
        val questions = mutableListOf<Question>()

        val quest1 = Question(
            1, "What is the purpose of keys in React lists?",
            "https://images.unsplash.com/photo-1633356122544-f134324a6cee?w=400",
            "To identify which items have changed",
            "To improve performance",
            "For styling purposes",
            "Both A and B",
            4
        )
        questions.add(quest1)

        val quest2 = Question(
            2, "What is the difference between state and props?",
            "https://images.unsplash.com/photo-1633356122102-3fe601e05bd2?w=400",
            "Props are immutable, state is mutable",
            "State is passed from parent, props are internal",
            "They are the same thing",
            "Props are for functions, state for classes",
            1
        )
        questions.add(quest2)

        val quest3 = Question(
            3, "What does JSX stand for?",
            "https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=400",
            "JavaScript XML",
            "Java Syntax Extension",
            "JavaScript Extension",
            "Just XML Syntax",
            1
        )
        questions.add(quest3)

        val quest4 = Question(
            4, "What is React Virtual DOM?",
            "https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=400",
            "A lightweight copy of the real DOM",
            "A new type of HTML element",
            "A database for React",
            "A browser extension",
            1
        )
        questions.add(quest4)

        val quest5 = Question(
            5, "Which hook is used for side effects in functional components?",
            "https://images.unsplash.com/photo-1633356122544-f134324a6cee?w=400",
            "useState",
            "useEffect",
            "useContext",
            "useReducer",
            2
        )
        questions.add(quest5)

        val quest6 = Question(
            6, "What is the correct way to update state in React?",
            "https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=400",
            "this.state.count = 5",
            "setState({count: 5})",
            "this.setState({count: 5})",
            "state.update(5)",
            3
        )
        questions.add(quest6)

        val quest7 = Question(
            7, "What is the purpose of useCallback hook?",
            "https://images.unsplash.com/photo-1633356122544-f134324a6cee?w=400",
            "To memoize functions",
            "To handle API calls",
            "To create callback functions",
            "To manage component state",
            1
        )
        questions.add(quest7)

        val quest8 = Question(
            8, "Which method is called after a component is rendered?",
            "https://images.unsplash.com/photo-1633356122102-3fe601e05bd2?w=400",
            "componentWillMount",
            "componentDidMount",
            "componentRendered",
            "componentReady",
            2
        )
        questions.add(quest8)

        val quest9 = Question(
            9, "What is React Context used for?",
            "https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=400",
            "Styling components",
            "Managing global state without prop drilling",
            "Handling forms",
            "Making API calls",
            2
        )
        questions.add(quest9)

        val quest10 = Question(
            10, "What is the difference between controlled and uncontrolled components?",
            "https://images.unsplash.com/photo-1633356122544-f134324a6cee?w=400",
            "Controlled components manage their own state",
            "Uncontrolled components are managed by React",
            "Controlled components are managed by React",
            "There is no difference",
            3
        )
        questions.add(quest10)

        val quest11 = Question(
            11, "What does the useMemo hook do?",
            "https://images.unsplash.com/photo-1633356122102-3fe601e05bd2?w=400",
            "Memoizes values",
            "Creates memory leaks",
            "Manages component memory",
            "Handles asynchronous operations",
            1
        )
        questions.add(quest11)

        val quest12 = Question(
            12, "What is React Fiber?",
            "https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=400",
            "A new reconciliation engine",
            "A CSS framework",
            "A testing library",
            "A build tool",
            1
        )
        questions.add(quest12)

        val quest13 = Question(
            13, "How do you handle events in React?",
            "https://images.unsplash.com/photo-1633356122544-f134324a6cee?w=400",
            "Using addEventListener",
            "With camelCase syntax like onClick",
            "Using jQuery",
            "With lowercase event names",
            2
        )
        questions.add(quest13)

        val quest14 = Question(
            14, "What is the purpose of React Fragments?",
            "https://images.unsplash.com/photo-1633356122102-3fe601e05bd2?w=400",
            "To group elements without adding extra nodes",
            "To create reusable components",
            "To improve performance",
            "To handle errors",
            1
        )
        questions.add(quest14)

        val quest15 = Question(
            15, "What is Redux used for?",
            "https://images.unsplash.com/photo-1627398242454-45a1465c2479?w=400",
            "State management",
            "Styling components",
            "API calls",
            "Form validation",
            1
        )
        questions.add(quest15)

        return questions
    }
}