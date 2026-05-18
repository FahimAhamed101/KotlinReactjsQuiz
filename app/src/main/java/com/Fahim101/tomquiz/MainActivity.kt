package com.Fahim101.tomquiz

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.Fahim101.tomquiz.R
import com.Fahim101.tomquiz.ui.QuestionsActivity
import com.Fahim101.tomquiz.utils.Constants

class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        val startButton: Button = this.findViewById(R.id.button_start)
        val editTextName: EditText = this.findViewById(R.id.name)

        startButton.setOnClickListener {
            if (!editTextName.text.isEmpty()) {
                Intent(this@MainActivity, QuestionsActivity::class.java).also {
                    it.putExtra(Constants.USER_NAME,editTextName.text.toString())
                    startActivity(it)
                    finish()
                }
            } else {
                Toast.makeText(this@MainActivity,"Please enter your name", Toast.LENGTH_LONG).show()
            }
        }
    }
}